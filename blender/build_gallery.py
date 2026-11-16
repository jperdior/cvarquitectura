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
from mathutils import Euler, Matrix, Quaternion, Vector

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


# ─── Entorno: árboles con ramas y hojas ─────────────────────────────────────
# Ramificación recursiva (troncos cónicos) + "tarjetas" de hojas con textura
# recortada por alfa: es la técnica habitual de árboles en tiempo real.
def leaf_atlas(name, size=512, seed=3):
    rng = np.random.default_rng(seed)
    img_rgba = np.zeros((size, size, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    greens = [(0.25, 0.38, 0.16), (0.33, 0.45, 0.2), (0.4, 0.5, 0.22), (0.22, 0.32, 0.15), (0.45, 0.52, 0.25)]
    for _ in range(26):
        cx, cy = 0.15 + rng.random() * 0.7, 0.15 + rng.random() * 0.7
        ang = rng.random() * math.pi * 2
        ln, wd = 0.13 + rng.random() * 0.08, 0.045 + rng.random() * 0.025
        dx, dy = xx - cx, yy - cy
        u = (dx * math.cos(ang) + dy * math.sin(ang)) / ln          # a lo largo de la hoja
        v = (-dx * math.sin(ang) + dy * math.cos(ang)) / wd         # a lo ancho
        t = np.clip((u + 1) / 2, 0, 1)
        shape = np.abs(v) < np.sin(np.pi * t) ** 0.8
        shape &= (u > -1) & (u < 1)
        col = np.array(greens[rng.integers(len(greens))], dtype=np.float32)
        shade = (0.8 + 0.35 * t)[..., None] * (1 - 0.25 * (np.abs(v) < 0.08)[..., None])  # nervio central
        rgb = np.clip(col[None, None, :] * shade, 0, 1)
        img_rgba[shape, :3] = rgb[shape]
        img_rgba[shape, 3] = 1.0
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.pixels.foreach_set(img_rgba[::-1].ravel())
    img.filepath_raw = os.path.join(TEX_DIR, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img


def leaf_material():
    m = bpy.data.materials.new("leaves")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) or nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = leaf_atlas("leaves")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.7
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    m.use_backface_culling = False
    MATS["leaves"] = m


leaf_material()
material("bark", "#5b4b3d", 0.95, tex=make_texture("bark", hex_rgb("#5e4e40"), 0.18, beta=1.0, seed=41, streaks=True))


def add_branch(bm, uv, a, b, r0, r1):
    d = b - a
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    mtx = Matrix.Translation((a + b) / 2) @ rot
    res = bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=7,
                                radius1=r0, radius2=r1, depth=d.length, matrix=mtx, calc_uvs=False)
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = 0
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (math.atan2(co.y - a.y, co.x - a.x) / math.pi, co.z * 0.6)


def add_leaf_card(bm, uv, c, size, rng):
    q = Euler((rng.random() * math.pi, rng.random() * math.pi, rng.random() * math.pi)).to_matrix()
    h = size / 2
    corners = [Vector((-h, -h, 0)), Vector((h, -h, 0)), Vector((h, h, 0)), Vector((-h, h, 0))]
    verts = [bm.verts.new(c + q @ p) for p in corners]
    f = bm.faces.new(verts)
    f.material_index = 1
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)


def grow(bm, uv, rng, start, direction, length, radius, depth, leaves):
    end = start + direction * length
    r_end = radius * 0.68
    add_branch(bm, uv, start, end, radius, r_end)
    if depth == 0:
        leaves.append(end)
        return
    # hojas también a lo largo de las ramas finas
    if depth <= 2:
        for _ in range(2):
            leaves.append(start + direction * length * rng.random())
    n = 2 if rng.random() < 0.55 else 3
    for _ in range(n):
        axis = direction.orthogonal().normalized()
        axis.rotate(Quaternion(direction, rng.random() * math.tau))
        ang = math.radians(22 + rng.random() * 26)
        nd = direction.copy()
        nd.rotate(Quaternion(axis, ang))
        nd = (nd + Vector((0, 0, 0.25))).normalized()  # tendencia a crecer hacia la luz
        grow(bm, uv, rng, end, nd, length * (0.68 + rng.random() * 0.12), r_end, depth - 1, leaves)


def tree(name, x, y, s, seed):
    rng = np.random.default_rng(seed)
    empty = bpy.data.objects.new(name, None)
    empty.location = (x, y, -0.31)
    scene.collection.objects.link(empty)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    leaves = []
    trunk_len = (2.2 + rng.random() * 0.8) * s
    lean = Vector(((rng.random() - 0.5) * 0.12, (rng.random() - 0.5) * 0.12, 1)).normalized()
    grow(bm, uv, rng, Vector((0, 0, 0)), lean, trunk_len, 0.2 * s, 5, leaves)
    for p in leaves:
        for _ in range(3):
            off = Vector(((rng.random() - 0.5), (rng.random() - 0.5), (rng.random() - 0.3))) * 0.7 * s
            add_leaf_card(bm, uv, p + off, (0.75 + rng.random() * 0.4) * s, rng)
    bm.normal_update()
    me = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS["bark"])
    me.materials.append(MATS["leaves"])
    obj = bpy.data.objects.new(name + "_mesh", me)
    obj.parent = empty
    scene.collection.objects.link(obj)


trees_three = [(-9, 6), (-12, -6), (14, -14), (-11, -26), (13, -34), (-12, -48), (14, -56), (-15, 12)]
for k, (tx, tz) in enumerate(trees_three):
    tree(f"site_tree_{k}", tx, -tz, 0.85 + (k % 3) * 0.15, 100 + k)


# ─── Exportar ───────────────────────────────────────────────────────────────
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)
print(f"OK → {OUT}  ({os.path.getsize(OUT) / 1024:.0f} KB)")
