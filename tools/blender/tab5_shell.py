# Turns M5Stack's Tab5 enclosure (m5stack/M5_Hardware, Products/C145_Tab5/Structures/Tab5.stl, MIT) into the room's
# model: the assembled copy of each part as a named node, metres, centred, the screen side facing +Z, Y up.
#   Blender -b -P tools/blender/tab5_shell.py -- <Tab5.stl> <out.glb> [preview-dir]
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
FLIP = "--flip" in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=src)
obj = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.001)
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')

def bounds(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))), Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))

# The file holds every part twice: assembled (Y 0..81) and laid out below it. Keep the assembled ones, by size.
NAMES = [("shell", (128.0, 80.0, 12.0)), ("back", (79.0, 76.3, 5.2)), ("battery_door", (38.2, 70.4, 5.9)), ("release", (8.0, 12.9, 6.5)), ("side_bar", (6.8, 32.6, 3.8))]
keep = {}
for o in list(bpy.context.scene.objects):
    mn, mx = bounds(o)
    size = mx - mn
    name = next((n for n, s in NAMES if all(abs(size[i] - s[i]) < 0.6 for i in range(3))), None)
    if name and mn.y > -1 and name not in keep:
        keep[name] = o
    else:
        bpy.data.objects.remove(o, do_unlink=True)
assert len(keep) == len(NAMES), keep.keys()

def material(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

MATS = {
    "shell": material("tab5_shell", (0.86, 0.86, 0.85), 0.55),
    "back": material("tab5_back", (0.80, 0.80, 0.79), 0.6),
    "battery_door": material("tab5_door", (0.80, 0.80, 0.79), 0.6),
    "release": material("tab5_release", (0.75, 0.05, 0.04), 0.45),
    "side_bar": material("tab5_bar", (0.80, 0.80, 0.79), 0.6),
}
# mm to m, centred on the shell; Z up in the file becomes the thickness axis here.
turn = Matrix.Rotation(math.pi, 4, 'Y') if FLIP else Matrix.Identity(4)
move = Matrix.Translation(Vector((-64.0, -40.89, 6.0)))
for name, o in keep.items():
    o.name = name
    o.data.name = name
    o.data.materials.clear()
    o.data.materials.append(MATS[name])
    o.data.transform(Matrix.Scale(0.001, 4) @ turn @ move)
    o.data.update()
    bpy.context.view_layer.objects.active = o
    for p in o.data.polygons:
        p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
    mn, mx = bounds(o)
    print(f"PART {name:13s} tris {len(o.data.polygons):6d} min ({mn.x*1000:7.2f},{mn.y*1000:7.2f},{mn.z*1000:6.2f}) max ({mx.x*1000:7.2f},{mx.y*1000:7.2f},{mx.z*1000:6.2f})")

if preview:
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = 1100, 760
    world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.52, 0.56, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN')); sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30)); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 70
    def shot(name, pos):
        cam.location = Vector(pos)
        d = -Vector(pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f"{preview}/{name}.png"
        bpy.ops.render.render(write_still=True)
    shot("front", (0.05, -0.02, 0.34)); shot("back", (-0.06, 0.03, -0.34)); shot("left", (-0.3, 0.02, 0.12)); shot("bottom", (0.02, -0.26, 0.16)); shot("top", (0.02, 0.26, 0.16)); shot("right", (0.3, 0.02, 0.12))

bpy.ops.object.select_all(action='SELECT')
# Y up on export: the file's Y is the device's height already, so export without the Z-up conversion.
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=False, export_apply=True, export_normals=True, export_materials='EXPORT')
print("WROTE", out)
