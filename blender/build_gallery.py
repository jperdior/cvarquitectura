"""
Genera la galería del portfolio en Blender y la exporta a GLB para la web.

Uso (sin abrir la interfaz):
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python blender/build_gallery.py -- --segments 6 --out models/gallery.glb

Convención de nombres (la web anima por nombre, ver blender/README.md):
  seg{i}_{pieza}[_{lado}][_{k}]   → un Empty con el origen en la BASE de la pieza
  site_*                          → entorno estático (árboles…)

Coordenadas: Blender es Z-arriba. La galería avanza en +Y (en la web, -Z).
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

# ─── Parámetros (deben coincidir con main.js) ───────────────────────────────
L, W, H = 10.0, 7.0, 4.2
GAP = 0.6                    # media anchura del lucernario
RW = W / 2 + 0.4 - GAP       # ancho de cada losa de cubierta

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--segments", type=int, default=6)
ap.add_argument("--out", default="models/gallery.glb")
args = ap.parse_args(argv)
N = args.segments
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, args.out)
TEX_DIR = os.path.join(ROOT, "blender", "textures")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
os.makedirs(TEX_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ─── Texturas procedurales (ruido rosa tileable vía FFT) ────────────────────
def noise_field(size, beta, seed):
    rng = np.random.default_rng(seed)
    white = rng.normal(size=(size, size))
    fx = np.fft.fftfreq(size)[:, None]
    fy = np.fft.fftfreq(size)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    field = np.real(np.fft.ifft2(np.fft.fft2(white) / f ** beta))
    field -= field.mean()
    return field / (np.abs(field).max() + 1e-9)


def make_texture(name, rgb, amp, beta=1.5, grain=0.04, seed=1, size=512, streaks=False):
    n = noise_field(size, beta, seed) * amp + noise_field(size, 0.2, seed + 7) * grain
    if streaks:  # vetas de madera: ruido estirado en una dirección
        n += np.repeat(noise_field(size, 1.0, seed + 3)[:, :1], size, axis=1) * amp * 1.4
    base = np.array(rgb, dtype=np.float32)[None, None, :]
    px = np.clip(base * (1.0 + n[:, :, None]), 0, 1)
    rgba = np.concatenate([px, np.ones((size, size, 1), dtype=np.float32)], axis=2)
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    path = os.path.join(TEX_DIR, f"{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def hex_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def srgb_to_linear(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ─── Materiales (Principled BSDF → exportables a glTF) ──────────────────────
MATS = {}


def material(name, color, rough=0.8, metal=0.0, alpha=1.0, tex=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nodes = m.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None) or nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(hex_rgb(color)), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex is not None:
        t = nodes.new("ShaderNodeTexImage")
        t.image = tex
        m.node_tree.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    MATS[name] = m
    return m


material("concrete", "#b4afa6", 0.9, tex=make_texture("concrete", hex_rgb("#b9b4ab"), 0.10, seed=11))
material("plaster", "#f2efe9", 0.95, tex=make_texture("plaster", hex_rgb("#f3f0ea"), 0.025, beta=1.2, grain=0.015, seed=5))
material("stone", "#cfc8bc", 0.45, tex=make_texture("stone", hex_rgb("#d3ccc0"), 0.07, beta=1.3, seed=23))
material("grout", "#7d776d", 1.0)
material("wood", "#8c7760", 0.65, tex=make_texture("wood", hex_rgb("#93806a"), 0.10, beta=1.0, seed=31, streaks=True))
material("metal_dark", "#2a2a28", 0.4, metal=0.8)
material("glass", "#c9dde6", 0.05, alpha=0.22)
material("foliage", "#6f8556", 0.9)
material("bark", "#5a4a3c", 0.9)


# ─── Geometría ──────────────────────────────────────────────────────────────
def mesh_from_boxes(name, boxes, uv_tile=1.0):
    """boxes: [(centro(x,y,z), tamaño(x,y,z), material)] en coords locales."""
    used = []
    for _, _, mname in boxes:
        if mname not in used:
            used.append(mname)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for c, s, mname in boxes:
        res = bmesh.ops.create_cube(bm, size=1.0)
        for v in res["verts"]:
            v.co = Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
        idx = used.index(mname)
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = idx
    bm.normal_update()
    # UV de proyección cúbica en metros → texturas a escala real sin estirarse
    for f in bm.faces:
        ax = max(range(3), key=lambda k: abs(f.normal[k]))
        for loop in f.loops:
            co = loop.vert.co
            u, v = ((co.y, co.z), (co.x, co.z), (co.x, co.y))[ax]
            loop[uv].uv = (u / uv_tile, v / uv_tile)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mname in used:
        me.materials.append(MATS[mname])
    return me


def element(name, base, boxes, bevel=0.012, uv_tile=2.0):
    """Empty en la base de la pieza + malla hija. La web anima el Empty."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.3
    empty.location = base
    scene.collection.objects.link(empty)
    obj = bpy.data.objects.new(name + "_mesh", mesh_from_boxes(name + "_mesh", boxes, uv_tile))
    obj.parent = empty
    scene.collection.objects.link(obj)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = "ANGLE"
    return empty


# ─── Tramos de galería ──────────────────────────────────────────────────────
for i in range(N):
    y0 = i * L
    yc = y0 + L / 2
    side = -1 if i % 2 == 0 else 1  # pared donde cuelga el proyecto (igual que main.js)

    # Losa de cimentación (+ peldaño de acceso en el primer tramo)
    slab = [((0, 0, 0.15), (W + 0.8, L, 0.3), "concrete")]
    if i == 0:
        slab.append(((0, -L / 2 - 0.6, 0.225), (W, 1.2, 0.15), "concrete"))
    element(f"seg{i}_slab", (0, yc, -0.3), slab)

    # Pavimento de piezas de piedra 1×1 con junta
    tiles = [((0, 0, 0.004), (W, L, 0.008), "grout")]
    nx, ny = int(W), int(L)
    for tx in range(nx):
        for ty in range(ny):
            cx = -W / 2 + (tx + 0.5) * (W / nx)
            cy = -L / 2 + (ty + 0.5) * (L / ny)
            tiles.append(((cx, cy, 0.012), (W / nx - 0.012, L / ny - 0.012, 0.016), "stone"))
    element(f"seg{i}_floor", (0, yc, 0), tiles, bevel=0.003, uv_tile=3.0)

    # Pilares de hormigón
    col_ys = [y0, y0 + L] if i == N - 1 else [y0]
    for k, cy in enumerate(col_ys):
        for sx, tag in ((-1, "L"), (1, "R")):
            element(f"seg{i}_col_{tag}_{k}", (sx * (W / 2 + 0.15), cy, -0.3),
                    [((0, 0, (H + 0.3) / 2), (0.45, 0.45, H + 0.3), "concrete")], bevel=0.02)

    # Muros: liso donde va el proyecto, ventana corrida alta en el opuesto.
    # Siempre: rodapié interior y lamas de madera por fuera.
    for sx, tag in ((-1, "L"), (1, "R")):
        lw = L - 0.45
        inner = -sx * 0.11
        outer = sx * 0.11
        boxes = []
        if sx == side:
            boxes.append(((0, 0, H / 2), (0.22, lw, H), "plaster"))
        else:
            boxes.append(((0, 0, 1.5), (0.22, lw, 3.0), "plaster"))
            boxes.append(((0, 0, (3.9 + H) / 2), (0.22, lw, H - 3.9), "plaster"))
            boxes.append(((0, 0, 3.45), (0.03, lw, 0.9), "glass"))
            for m in range(9):
                my = -lw / 2 + m * (lw / 8)
                boxes.append(((0, my, 3.45), (0.08, 0.06, 0.9), "metal_dark"))
        boxes.append(((inner + -sx * 0.008, 0, 0.05), (0.016, lw, 0.1), "metal_dark"))
        n_fins = 18
        for f in range(n_fins):
            fy = -lw / 2 + (f + 0.5) * (lw / n_fins)
            boxes.append(((outer + sx * 0.14, fy, (H + 0.3) / 2 - 0.3), (0.26, 0.05, H + 0.6), "wood"))
        boxes.append(((outer + sx * 0.05, 0, -0.05), (0.08, lw, 0.1), "metal_dark"))  # carril inferior
        element(f"seg{i}_wall_{tag}", (sx * (W / 2 + 0.11), yc, 0), boxes, bevel=0.004)

    # Cubierta: dos losas con techo enlucido y peto perimetral
    for sx, tag in ((-1, "L"), (1, "R")):
        boxes = [
            ((0, 0, 0.15), (RW, L, 0.3), "concrete"),
            ((0, 0, -0.008), (RW - 0.02, L, 0.016), "plaster"),
            ((sx * (RW / 2 - 0.075), 0, 0.3 + 0.175), (0.15, L, 0.35), "concrete"),
        ]
        element(f"seg{i}_roof_{tag}", (sx * (GAP + RW / 2), yc, H), boxes)

    # Lucernario de vidrio con perfilería
    sky = [((0, 0, 0.05), (GAP * 2 + 0.2, L, 0.02), "glass")]
    for m in range(5):
        sky.append(((0, -L / 2 + m * (L / 4), 0.07), (GAP * 2 + 0.2, 0.05, 0.06), "metal_dark"))
    for sx in (-1, 1):
        sky.append(((sx * (GAP + 0.05), 0, 0.07), (0.05, L, 0.06), "metal_dark"))
    element(f"seg{i}_skylight", (0, yc, H + 0.3), sky, bevel=0)

    element(f"seg{i}_beam", (0, yc, H), [((0, 0, 0.15), (GAP * 2 + 0.2, 0.3, 0.3), "concrete")])

    # Banco frente al proyecto, junto a la pared opuesta
    bench = [((0, 0, 0.42), (0.5, 2.4, 0.08), "wood")]
    for by in (-1.0, 1.0):
        bench.append(((0, by, 0.19), (0.42, 0.08, 0.38), "metal_dark"))
    element(f"seg{i}_bench", (-side * (W / 2 - 0.55), yc, 0), bench, bevel=0.01)

    if i == 0:
        canopy = [((0, 0, 0.11), (W + 3, 3.2, 0.22), "concrete"),
                  ((0, 0, -0.006), (W + 2.9, 3.1, 0.012), "plaster")]
        element("seg0_canopy", (0, -1.6, H - 0.2), canopy)

    if i == N - 1:
        element(f"seg{i}_back", (0, N * L + 0.12, 0), [((0, 0, H / 2), (W + 0.8, 0.25, H), "plaster")])


# ─── Entorno: árboles low-poly ──────────────────────────────────────────────
def tree(name, x, y, s, seed):
    rng = np.random.default_rng(seed)
    empty = bpy.data.objects.new(name, None)
    empty.location = (x, y, -0.31)
    scene.collection.objects.link(empty)
    bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.13 * s, depth=2.6 * s, location=(0, 0, 1.3 * s))
    trunk = bpy.context.active_object
    trunk.name = name + "_trunk"
    trunk.data.materials.append(MATS["bark"])
    trunk.parent = empty
    for k in range(3):
        r = (1.0 + rng.random() * 0.6) * s
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=1, radius=r,
            location=((rng.random() - 0.5) * 1.2 * s, (rng.random() - 0.5) * 1.2 * s, (2.8 + k * 0.7 + rng.random() * 0.4) * s))
        crown = bpy.context.active_object
        crown.name = f"{name}_crown{k}"
        crown.data.materials.append(MATS["foliage"])
        crown.parent = empty


trees_three = [(-9, 6), (-12, -6), (14, -14), (-11, -26), (13, -34), (-12, -48), (14, -56), (-15, 12)]
for k, (tx, tz) in enumerate(trees_three):
    tree(f"site_tree_{k}", tx, -tz, 0.75 + (k % 3) * 0.15, 100 + k)


# ─── Exportar ───────────────────────────────────────────────────────────────
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)
print(f"OK → {OUT}  ({os.path.getsize(OUT) / 1024:.0f} KB)")
