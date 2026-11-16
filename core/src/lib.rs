//! The room's renderer for the app: ThreeRT's live path tracer and the game script that builds and animates the
//! room, drawn on a CAMetalLayer the app owns. The app (SwiftUI) calls in through the C ABI at the end of this file.
//!
//! Everything runs on one thread of its own: the GPU device, the script runtime and the present. Calls from the app
//! are commands in a channel; what the game posts and the renderer's statistics wait in a queue the app polls. A
//! frame that takes long never holds the app's main thread.
//!
//! Screens in the room are stream textures (the engine's `StreamTexture`): the app hands over RGBA frames by name
//! (`bench_stream`), and the newest one is written into the texture's place before the next frame is traced.

use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use threert_render::host::{launch_message_with_caps, InputTracker};
use threert_render::live::{next_spp, save_bgra, LiveCore};
use threert_render::script::GameSession;
use threert_render::{audio::Audio, gpu};

enum Cmd {
    Resize(u32, u32, f32),
    Pointer(f32, f32),
    Button(u8, bool),
    Wheel(f32),
    Key(String, String, bool),
    /// Host-channel messages for the game.
    Send(Vec<serde_json::Value>),
    Snapshot(PathBuf),
    Reload(PathBuf),
    Quality { fps: u32, scale: f32, bounces: u32 },
    Quit,
}

struct Frame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[derive(Default)]
struct Shared {
    /// What the game posted and what the renderer reports, as JSON objects, oldest first.
    posts: Mutex<Vec<String>>,
    /// The newest frame of each stream that has not been uploaded yet.
    streams: Mutex<HashMap<String, Frame>>,
    quit: AtomicBool,
}

impl Shared {
    fn post(&self, v: serde_json::Value) {
        let mut q = self.posts.lock().unwrap();
        // (An app that stopped polling does not grow the queue without bound.)
        if q.len() > 4096 {
            q.drain(..2048);
        }
        q.push(v.to_string());
    }
}

pub struct BenchHost {
    tx: mpsc::Sender<Cmd>,
    shared: Arc<Shared>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct Args {
    layer: usize,
    width: u32,
    height: u32,
    scale: f32,
    bundle: PathBuf,
    assets: PathBuf,
    presets: PathBuf,
}

struct State {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    core: LiveCore,
    game: GameSession,
    input: InputTracker,
    audio: Audio,
    blit: wgpu::RenderPipeline,
    blit_layout: wgpu::BindGroupLayout,
    blit_size: wgpu::Buffer,
    blit_bg: wgpu::BindGroup,
    /// The size the app last asked for, pixels.
    want: (u32, u32),
    shown: bool,
    spp: u32,
    fps: u32,
    max_bounces: u32,
    last: Instant,
    frames: u32,
    stats_t: Instant,
    snapshot: Option<PathBuf>,
    assets: PathBuf,
}

fn init(a: &Args) -> Result<State> {
    let g = gpu::Gpu::new()?;
    // The layer is the app's, alive until `bench_destroy` joined this thread.
    let surface = unsafe { g.instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(a.layer as *mut c_void)) }.context("surface on the layer")?;
    let caps = surface.get_capabilities(&g.adapter);
    // The renderer outputs sRGB-encoded bytes already: present through a non-sRGB format.
    let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width: a.width.max(1),
        height: a.height.max(1),
        present_mode: wgpu::PresentMode::Fifo,
        desired_maximum_frame_latency: 2,
        alpha_mode: caps.alpha_modes[0],
        view_formats: vec![],
        color_space: Default::default(),
    };
    surface.configure(&g.device, &config);
    let (mut game, mut core) = GameSession::start(&a.bundle, "bench", &a.assets, g, &a.presets, config.width, config.height)?;
    if let Err(e) = game.host_messages(&mut core, &[launch_message_with_caps(None, &[])]) {
        eprintln!("bench-core: launch: {e:#}");
    }
    core.bounces = 4;
    core.set_scale(0.0);
    core.set_display_scale(a.scale);
    let d = &core.g.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("blit"), source: wgpu::ShaderSource::Wgsl(BLIT.into()) });
    let buffer = |binding, ty| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Buffer { ty, has_dynamic_offset: false, min_binding_size: None }, count: None };
    let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &[buffer(0, wgpu::BufferBindingType::Storage { read_only: true }), buffer(1, wgpu::BufferBindingType::Uniform)] });
    let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
    let blit = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("blit"),
        layout: Some(&pl),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), targets: &[Some(format.into())], compilation_options: Default::default() }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    let blit_size = d.create_buffer(&wgpu::BufferDescriptor { label: Some("blit size"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
    core.g.queue.write_buffer(&blit_size, 0, bytemuck::cast_slice(&[core.w as f32, core.h as f32, config.width as f32, config.height as f32]));
    let blit_bg = blit_bind_group(d, &layout, &core.targets.out, &blit_size);
    let mut audio = Audio::new();
    audio.open(&a.assets);
    Ok(State {
        want: (config.width, config.height),
        surface,
        config,
        core,
        game,
        input: InputTracker::new(),
        audio,
        blit,
        blit_layout: layout,
        blit_size,
        blit_bg,
        shown: false,
        spp: 1,
        fps: 60,
        max_bounces: 4,
        last: Instant::now(),
        frames: 0,
        stats_t: Instant::now(),
        snapshot: None,
        assets: a.assets.clone(),
    })
}

fn blit_bind_group(d: &wgpu::Device, layout: &wgpu::BindGroupLayout, out: &wgpu::Buffer, size: &wgpu::Buffer) -> wgpu::BindGroup {
    d.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("blit"), layout, entries: &[wgpu::BindGroupEntry { binding: 0, resource: out.as_entire_binding() }, wgpu::BindGroupEntry { binding: 1, resource: size.as_entire_binding() }] })
}

/// The surface and the view at the size the app asked for.
fn fit(s: &mut State) -> bool {
    let (w, h) = s.want;
    if w == 0 || h == 0 || (w, h) == (s.config.width, s.config.height) {
        return false;
    }
    (s.config.width, s.config.height) = (w, h);
    s.surface.configure(&s.core.g.device, &s.config);
    let before = (s.core.w, s.core.h);
    if let Err(e) = s.core.resize(w, h) {
        eprintln!("bench-core: {e:#}");
    }
    s.core.g.queue.write_buffer(&s.blit_size, 0, bytemuck::cast_slice(&[s.core.w as f32, s.core.h as f32, w as f32, h as f32]));
    s.blit_bg = blit_bind_group(&s.core.g.device, &s.blit_layout, &s.core.targets.out, &s.blit_size);
    (s.core.w, s.core.h) != before
}

fn acquire(s: &mut State) -> Result<Option<wgpu::SurfaceTexture>> {
    use wgpu::CurrentSurfaceTexture as T;
    let tex = match s.surface.get_current_texture() {
        T::Success(t) | T::Suboptimal(t) => Some(t),
        T::Timeout | T::Occluded => None,
        T::Outdated | T::Lost => {
            s.surface.configure(&s.core.g.device, &s.config);
            None
        }
        T::Validation => return Err(anyhow!("surface: a validation error")),
    };
    s.shown = tex.is_some();
    Ok(tex)
}

fn pass<'a>(e: &'a mut wgpu::CommandEncoder, view: &wgpu::TextureView, blit: &wgpu::RenderPipeline, bg: &wgpu::BindGroup) {
    let mut rp = e.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("blit"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment { view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    rp.set_pipeline(blit);
    rp.set_bind_group(0, bg, &[]);
    rp.draw(0..3, 0..1);
}

fn reshow(s: &mut State) -> Result<()> {
    let Some(tex) = acquire(s)? else {
        std::thread::sleep(Duration::from_millis(4));
        return Ok(());
    };
    let view = tex.texture.create_view(&Default::default());
    let mut e = s.core.g.device.create_command_encoder(&Default::default());
    pass(&mut e, &view, &s.blit, &s.blit_bg);
    s.core.g.queue.submit([e.finish()]);
    s.core.g.queue.present(tex);
    Ok(())
}

fn frame(s: &mut State, shared: &Shared) -> Result<()> {
    let resized = fit(s);
    let period = Duration::from_secs_f64(1.0 / s.fps as f64);
    if !resized && s.last.elapsed() + Duration::from_millis(2) < period {
        return reshow(s);
    }
    let dt = s.last.elapsed().as_secs_f32().min(0.1);
    s.last = Instant::now();
    // The screens' newest frames, into their textures' places.
    let frames: Vec<(String, Frame)> = shared.streams.lock().unwrap().drain().collect();
    for (name, f) in frames {
        if let Err(e) = s.core.write_stream(&name, f.width, f.height, &f.rgba) {
            eprintln!("bench-core: stream {name}: {e:#}");
        }
    }
    s.core.advance_time(dt);
    let messages = [s.input.message()];
    if let Err(e) = s.game.host_messages(&mut s.core, &messages) {
        shared.post(serde_json::json!({ "t": "bench.error", "where": "input", "message": format!("{e:#}") }));
    }
    if let Err(e) = s.game.frame(&mut s.core, dt) {
        shared.post(serde_json::json!({ "t": "bench.error", "where": "frame", "message": format!("{e:#}") }));
    }
    for p in s.game.take_posts() {
        if s.audio.post(&p) {
            continue;
        }
        shared.post(p);
    }
    let c = s.core.cam;
    s.audio.listener(c.pos, c.fwd, c.right);
    for (level, text) in s.audio.take_log() {
        eprintln!("bench-core: audio: {level}: {text}");
    }

    let Some(tex) = acquire(s)? else {
        std::thread::sleep(Duration::from_millis(8));
        return Ok(());
    };
    let view = tex.texture.create_view(&Default::default());
    let (blit, bg) = (&s.blit, &s.blit_bg);
    let snap = s.snapshot.take().map(|p| {
        let buf = s.core.g.device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (s.core.w * s.core.h * 4) as u64, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        (p, buf)
    });
    s.core.render(s.spp, |e, out| {
        pass(e, &view, blit, bg);
        if let Some((_, buf)) = &snap {
            e.copy_buffer_to_buffer(out, 0, buf, 0, buf.size());
        }
    });
    s.core.g.queue.present(tex);
    if let Some((path, buf)) = snap {
        buf.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        s.core.g.device.poll(wgpu::PollType::wait_indefinitely())?;
        let px = buf.slice(..).get_mapped_range()?.to_vec();
        save_bgra(&path, &px, s.core.w, s.core.h);
        shared.post(serde_json::json!({ "t": "bench.snapshot", "path": path, "width": s.core.w, "height": s.core.h }));
    }
    // The frame governor of the engine's own window (view.rs): render scale first, then samples, then bounces.
    s.core.govern_resolution(s.fps);
    s.spp = if s.core.render_scale < 1.0 { 1 } else { next_spp(s.spp, s.core.gpu_ms, s.fps).min(8) };
    if s.core.frame % 30 == 1 {
        let budget = 1000.0 / s.fps as f32;
        let lowest = !s.core.dynamic_res || s.core.render_scale <= s.core.min_scale;
        if s.spp == 1 && lowest && s.core.gpu_ms > budget * 0.92 && s.core.bounces > 2 {
            s.core.bounces -= 1;
        } else if s.core.gpu_ms < budget * 0.55 && s.core.bounces < s.max_bounces {
            s.core.bounces += 1;
        }
    }
    s.frames += 1;
    if s.stats_t.elapsed() >= Duration::from_millis(1000) {
        let fps = s.frames as f32 / s.stats_t.elapsed().as_secs_f32();
        s.frames = 0;
        s.stats_t = Instant::now();
        shared.post(serde_json::json!({
            "t": "bench.stats", "fps": fps, "gpuMs": s.core.gpu_ms, "scale": s.core.render_scale, "spp": s.spp, "bounces": s.core.bounces,
            "scriptMs": s.game.frame_ms, "width": s.core.w, "height": s.core.h, "history": s.core.history_len,
        }));
    }
    Ok(())
}

fn run(a: Args, rx: mpsc::Receiver<Cmd>, shared: Arc<Shared>) {
    let mut s = match init(&a) {
        Ok(s) => s,
        Err(e) => {
            shared.post(serde_json::json!({ "t": "bench.fatal", "message": format!("{e:#}") }));
            return;
        }
    };
    shared.post(serde_json::json!({ "t": "bench.ready", "adapter": s.core.g.adapter_info.name, "hwrt": s.core.g.hwrt, "width": s.core.w, "height": s.core.h }));
    while !shared.quit.load(Ordering::Relaxed) {
        while let Ok(c) = rx.try_recv() {
            match c {
                Cmd::Resize(w, h, scale) => {
                    s.want = (w.max(1), h.max(1));
                    s.core.set_display_scale(scale);
                }
                Cmd::Pointer(u, v) => s.input.pointer(u, v),
                Cmd::Button(n, down) => s.input.button(n, down),
                Cmd::Wheel(d) => s.input.wheel(d),
                Cmd::Key(code, name, down) => s.input.key(&code, &name, down),
                Cmd::Send(messages) => {
                    if let Err(e) = s.game.host_messages(&mut s.core, &messages) {
                        shared.post(serde_json::json!({ "t": "bench.error", "where": "message", "message": format!("{e:#}") }));
                    }
                }
                Cmd::Snapshot(p) => s.snapshot = Some(p),
                Cmd::Reload(bundle) => match GameSession::open(&bundle, "bench", &s.assets, &mut s.core) {
                    Ok(mut game) => {
                        let _ = game.host_messages(&mut s.core, &[launch_message_with_caps(None, &[])]);
                        s.game = game;
                        s.input = InputTracker::new();
                        shared.post(serde_json::json!({ "t": "bench.reloaded" }));
                    }
                    Err(e) => shared.post(serde_json::json!({ "t": "bench.error", "where": "reload", "message": format!("{e:#}") })),
                },
                Cmd::Quality { fps, scale, bounces } => {
                    s.fps = fps.clamp(15, 120);
                    s.core.set_scale(scale);
                    s.max_bounces = bounces.clamp(1, 8);
                    s.core.bounces = s.max_bounces;
                }
                Cmd::Quit => return,
            }
        }
        if let Err(e) = frame(&mut s, &shared) {
            shared.post(serde_json::json!({ "t": "bench.error", "where": "render", "message": format!("{e:#}") }));
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

const BLIT: &str = r#"
struct Size { view: vec2<f32>, surface: vec2<f32> }
@group(0) @binding(0) var<storage, read> px: array<u32>;
@group(0) @binding(1) var<uniform> size: Size;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn texel(x: i32, y: i32) -> vec4<f32> {
    let c = px[u32(clamp(y, 0, i32(size.view.y) - 1)) * u32(size.view.x) + u32(clamp(x, 0, i32(size.view.x) - 1))];
    return vec4<f32>(f32((c >> 16u) & 255u), f32((c >> 8u) & 255u), f32(c & 255u), 255.0) / 255.0;
}

@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let q = p.xy / size.surface * size.view - 0.5;
    let f = fract(q);
    let i = vec2<i32>(floor(q));
    let a = mix(texel(i.x, i.y), texel(i.x + 1, i.y), f.x);
    let b = mix(texel(i.x, i.y + 1), texel(i.x + 1, i.y + 1), f.x);
    return mix(a, b, f.y);
}
"#;

// ----- the C ABI -----

unsafe fn text(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

/// Starts the room on `metal_layer` (a CAMetalLayer the caller keeps alive until `bench_destroy`), `width` x
/// `height` pixels, `scale` pixels a point. `bundle` is the room's game bundle, `assets` the root its assets resolve
/// against, `presets` the engine's presets directory. Returns at once; `bench.ready` or `bench.fatal` arrives in
/// `bench_poll`.
#[no_mangle]
pub unsafe extern "C" fn bench_create(metal_layer: *mut c_void, width: u32, height: u32, scale: f32, bundle: *const c_char, assets: *const c_char, presets: *const c_char) -> *mut BenchHost {
    let args = Args { layer: metal_layer as usize, width, height, scale, bundle: PathBuf::from(text(bundle)), assets: PathBuf::from(text(assets)), presets: PathBuf::from(text(presets)) };
    let (tx, rx) = mpsc::channel();
    let shared = Arc::new(Shared::default());
    let theirs = shared.clone();
    let thread = std::thread::Builder::new().name("bench-render".into()).stack_size(64 << 20).spawn(move || run(args, rx, theirs)).ok();
    Box::into_raw(Box::new(BenchHost { tx, shared, thread }))
}

unsafe fn send(h: *mut BenchHost, c: Cmd) {
    if let Some(h) = h.as_ref() {
        let _ = h.tx.send(c);
    }
}

#[no_mangle]
pub unsafe extern "C" fn bench_resize(h: *mut BenchHost, width: u32, height: u32, scale: f32) {
    send(h, Cmd::Resize(width, height, scale));
}

/// The pointer's place in the view, 0..1 from its top left.
#[no_mangle]
pub unsafe extern "C" fn bench_pointer(h: *mut BenchHost, u: f32, v: f32) {
    send(h, Cmd::Pointer(u, v));
}

/// A pointer button (0 left, 1 middle, 2 right) went down or up.
#[no_mangle]
pub unsafe extern "C" fn bench_button(h: *mut BenchHost, button: u8, down: bool) {
    send(h, Cmd::Button(button, down));
}

#[no_mangle]
pub unsafe extern "C" fn bench_wheel(h: *mut BenchHost, notches: f32) {
    send(h, Cmd::Wheel(notches));
}

/// A key by its place on the keyboard (`code`: "KeyW") and the name game code reads ("W").
#[no_mangle]
pub unsafe extern "C" fn bench_key(h: *mut BenchHost, code: *const c_char, name: *const c_char, down: bool) {
    send(h, Cmd::Key(text(code), text(name), down));
}

/// Host-channel messages for the game: a JSON object, or an array of them.
#[no_mangle]
pub unsafe extern "C" fn bench_send(h: *mut BenchHost, json: *const c_char) {
    let messages = match serde_json::from_str::<serde_json::Value>(&text(json)) {
        Ok(serde_json::Value::Array(a)) => a,
        Ok(v) => vec![v],
        Err(_) => return,
    };
    send(h, Cmd::Send(messages));
}

/// What the game posted and what the renderer reports since the last call: a JSON array, or null when there is
/// nothing. Free it with `bench_free`.
#[no_mangle]
pub unsafe extern "C" fn bench_poll(h: *mut BenchHost) -> *mut c_char {
    let Some(h) = h.as_ref() else { return std::ptr::null_mut() };
    let posts = std::mem::take(&mut *h.shared.posts.lock().unwrap());
    if posts.is_empty() {
        return std::ptr::null_mut();
    }
    CString::new(format!("[{}]", posts.join(","))).map_or(std::ptr::null_mut(), CString::into_raw)
}

#[no_mangle]
pub unsafe extern "C" fn bench_free(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// The next frame of the stream texture `name`: `width` x `height` RGBA8 pixels, copied before the call returns.
/// Only the newest frame of a stream is kept until the renderer takes it.
#[no_mangle]
pub unsafe extern "C" fn bench_stream(h: *mut BenchHost, name: *const c_char, width: u32, height: u32, rgba: *const u8, len: usize) {
    let Some(h) = h.as_ref() else { return };
    if rgba.is_null() || len != width as usize * height as usize * 4 {
        return;
    }
    let frame = Frame { width, height, rgba: std::slice::from_raw_parts(rgba, len).to_vec() };
    h.shared.streams.lock().unwrap().insert(text(name), frame);
}

/// Saves the next traced frame as a PNG; `bench.snapshot` in `bench_poll` says when it is written.
#[no_mangle]
pub unsafe extern "C" fn bench_snapshot(h: *mut BenchHost, path: *const c_char) {
    send(h, Cmd::Snapshot(PathBuf::from(text(path))));
}

/// Runs another build of the room's bundle in the same view.
#[no_mangle]
pub unsafe extern "C" fn bench_reload(h: *mut BenchHost, bundle: *const c_char) {
    send(h, Cmd::Reload(PathBuf::from(text(bundle))));
}

/// Content frames a second, render scale (0: dynamic) and the most bounces.
#[no_mangle]
pub unsafe extern "C" fn bench_quality(h: *mut BenchHost, fps: u32, scale: f32, bounces: u32) {
    send(h, Cmd::Quality { fps, scale, bounces });
}

#[no_mangle]
pub unsafe extern "C" fn bench_destroy(h: *mut BenchHost) {
    if h.is_null() {
        return;
    }
    let mut h = Box::from_raw(h);
    h.shared.quit.store(true, Ordering::Relaxed);
    let _ = h.tx.send(Cmd::Quit);
    if let Some(t) = h.thread.take() {
        let _ = t.join();
    }
}

#[allow(dead_code)]
fn _paths(_: &Path) {}
