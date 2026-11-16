# Modelo de Blender

`build_gallery.py` genera la galería y la exporta a `models/gallery.glb`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python blender/build_gallery.py -- --segments 6 --out models/gallery.glb
```

## Convención para modelar a mano

La web anima las piezas **por nombre**. Si se modela el edificio a mano en Blender, basta con respetar esto:

- Cada pieza es un **Empty** colocado en la **base** de la pieza, con sus mallas como hijas.
- Nombre del Empty: `seg{i}_{pieza}[_{L|R}][_{k}]`, donde `i` es el tramo (0 = entrada) y cada tramo mide 10 m en +Y.
- Piezas con animación de montaje: `slab`, `floor`, `col`, `wall`, `roof`, `beam`, `skylight`, `canopy`, `bench`, `back`. Una pieza con otro nombre aparece sin animación.
- `site_*` es el entorno estático (árboles, terreno…).
- Los materiales llamados `glass` no arrojan sombra en la web.
- Los cuadros de los proyectos, los rótulos y la tarjeta de contacto no se modelan: los coloca la web a partir de `data/projects.js`.
