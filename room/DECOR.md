# Building parts of the room

The room is a hardware studio modelled on a real one (grey walls, green anti-static mats and floor, white steel
benches, a wall of small-parts drawers, a dark pegboard of hand tools, bench instruments, black mesh chairs). It is
path-traced live by ThreeRT (`engine/`), so what makes it read as real is correct scale, bevelled edges, believable
materials and a lot of small things at human scale: not textures.

## Rules

- **Units:** metres (`mm` from `room/lib.ts` is 0.001), Y up. The origin is on the floor under the middle of the
  main bench's front edge; X to the right along the back wall, Z toward the viewer. `room/layout.ts` has the room,
  the bench and the riser. Real dimensions: look them up, do not guess (a bench oscilloscope is ~310 x 150 x 120 mm).
- **One module per part** in `room/decor/<name>.ts`, exporting `build<Name>(scene: Scene): <handles or void>`. Build
  with the `Kit` of `room/lib.ts` (`box`, `soft` = a box with rounded edges, `drum`, `rod`, `ball`, `mesh`, `group`)
  and its shapes (`roundedBox`, `roundedPlate`, `tube`, `curve`) and materials (`std`, `coated`, `glow`,
  `noiseTexture`). The scene API is three.js-like (`@threert/scene`: `engine/packages/scene/README.md`,
  `engine/packages/scene/src/{core,geometry,math}.ts`); its math is a subset of three.js's (e.g. no
  `Quaternion.setFromUnitVectors`: `aim()` in lib.ts does that). Do not edit `room/lib.ts`, `room/layout.ts`,
  `room/shell.ts`, `room/bench.ts`, `room/tab5.ts` or `room/bench.game.ts`: put helpers you need in your own module
  and list what you would move into lib.ts in your report.
- **Ids:** `kit.box("oscilloscope", ...)`: every mesh of one thing shares the id's name (the Kit numbers repeats).
  Anything the user might later click gets its own group id (`scope`, `psu`, `drawer-wall`, `clipboard-0` ...).
- **Edges:** nothing manufactured has a razor edge. Use `kit.soft` / `roundedBox` with a 0.5-3 mm radius on every
  visible body; plain `kit.box` only for things thinner than 2 mm or never seen up close.
- **Materials:** physically plausible. Plastics roughness 0.35-0.6; anodised or painted metal `metalness` 0.6-1 with
  roughness 0.25-0.45; rubber 0.8+. Colours are sRGB hex. Glass and screens: `MeshPhysicalMaterial` with
  `clearcoat` (no `transmission` on small parts: live glass is coarse). Emissive parts (`glow(name, colour, nits)`):
  an LED indicator 800-3000 nits, an LCD or scope screen 120-250 nits, a 7-segment display 400-900 nits. Keep
  emitters few and small; they are real lights in the path tracer. Do not add RectAreaLight / PointLight / SpotLight
  (the room's lighting is set elsewhere) unless your brief says so.
- **Print:** text and panel artwork are SVG files in `room/art/<your module>/*.svg` (their `width`/`height`
  attributes are texels, at most 2048; fonts: "Helvetica Neue", "PingFang SC", "Menlo"), rendered by
  `vendor/bin/bun tools/art.ts` to `room/assets/gen/<same path>.png` and used as
  `new Texture("room/assets/gen/<module>/<file>.png")` on a `PlaneGeometry` or a `roundedPlate` laid 0.2 mm above
  the surface. No trademarks or logos of real brands on instruments: invent neutral names ("DS-1104", "Bench
  Supply 30V 5A"). M5Stack's own name may appear on Units and on studio signage.
- **Budget:** each module at most ~120 k triangles and ~25 materials; share geometries and materials between
  repeats; use `InstancedMesh` for big repeats (drawers, pegboard holes are a texture, not geometry). Curved parts:
  16-28 sides is enough. Textures at most 1024 px unless they are a large printed surface.
- **Deterministic:** no `Math.random` (use `rng(seed)` of lib.ts), no dates.
- **Static unless told otherwise.** Things the app will animate or swap are named in the brief and returned as
  handles (the object and its material).

## Looking at your work

```
vendor/bin/bun tools/art.ts                                        # SVG -> PNG, when you changed art
vendor/bin/bun tools/look.ts <view> --game room/decor/<name>.preview.game.ts --spp 96
```

`tools/look.ts` bundles a game and renders named views with the offline path tracer (about 5 s each at 1440 x 900;
PNG in `.build/look/<view>.png`). A view is a name of `VIEWS` in `room/layout.ts` or `name={"position":[x,y,z],
"target":[x,y,z],"fov":deg}`. Write `room/decor/<name>.preview.game.ts` like `room/bench.game.ts`: build the shell
and the bench, then your module, so your part is seen in its place and light. **Look at every render** (read the
PNG), from the room view, a mid view and close-ups at 30-60 cm, list the three biggest differences from the real
thing, fix them, and repeat at least four rounds. Things to check each time: scale against the bench (0.76 m high,
1.9 m wide) and the Tab5 (128 x 80 mm); floating or intersecting parts; razor edges; flat single-colour faces
larger than a hand; unreadable or mirrored print; emissive parts blowing out; dark holes where a back or underside
is missing.

A render that fails prints the script error. GPU time is shared with other people rendering: keep `--spp` at 96 or
less while iterating and render one view at a time.
