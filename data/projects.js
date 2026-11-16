// Datos dummy. Más adelante esto puede venir de un JSON, un CMS headless (Sanity, Strapi…)
// o de un Google Sheet. La escena 3D sólo necesita esta forma de datos.

export const architect = {
  name: 'Nombre Apellido',
  role: 'Arquitecto · Estudio Dummy',
  email: 'hola@estudio-dummy.com',
  city: 'Madrid',
};

export const projects = [
  {
    id: 'casa-patio',
    title: 'Casa Patio',
    year: 2019,
    location: 'Valencia',
    type: 'Vivienda unifamiliar',
    surface: '240 m²',
    kind: 'casa',
    palette: ['#cfe0ea', '#f4efe6', '#b9b09c', '#efe9dd'],
    description:
      'Vivienda organizada alrededor de un patio central que actúa como regulador térmico y corazón de la casa. Muros de ladrillo visto y carpinterías de madera.',
  },
  {
    id: 'pabellon-rio',
    title: 'Pabellón del Río',
    year: 2020,
    location: 'Zaragoza',
    type: 'Equipamiento cultural',
    surface: '680 m²',
    kind: 'pabellon',
    palette: ['#d9d3e8', '#f6efe8', '#9fae96', '#f2f2f2'],
    description:
      'Pabellón ligero de estructura metálica junto a la ribera. Una cubierta continua unifica los espacios expositivos y abre vistas al paisaje.',
  },
  {
    id: 'torre-norte',
    title: 'Torre Norte',
    year: 2021,
    location: 'Bilbao',
    type: 'Residencial colectivo',
    surface: '7.400 m²',
    kind: 'torre',
    palette: ['#bfd2de', '#eef1f2', '#8e9590', '#e6e1d8'],
    description:
      'Torre de 18 plantas con fachada de lamas cerámicas. Las terrazas giran en cada nivel para captar el sol y romper la escala del volumen.',
  },
  {
    id: 'escuela-pinar',
    title: 'Escuela en el Pinar',
    year: 2022,
    location: 'Segovia',
    type: 'Educativo',
    surface: '2.150 m²',
    kind: 'escuela',
    palette: ['#e3e7d4', '#f7f3ea', '#88936f', '#efe4d0'],
    description:
      'Escuela infantil en una sola planta que se fragmenta en pabellones entre pinos existentes. Madera contralaminada y patios de juego cubiertos.',
  },
  {
    id: 'mercado-sur',
    title: 'Rehabilitación Mercado Sur',
    year: 2023,
    location: 'Sevilla',
    type: 'Rehabilitación',
    surface: '3.900 m²',
    kind: 'mercado',
    palette: ['#f0dccb', '#f8f1e7', '#c2a98a', '#f3e6d4'],
    description:
      'Recuperación de un mercado de abastos de 1928. Se restaura la estructura de hormigón original y se incorpora una nueva cubierta ventilada.',
  },
  {
    id: 'refugio-alto',
    title: 'Refugio Alto',
    year: 2024,
    location: 'Huesca',
    type: 'Concurso · 1er premio',
    surface: '310 m²',
    kind: 'refugio',
    palette: ['#cfd9e6', '#f3f4f6', '#9aa3a8', '#e9e6e1'],
    description:
      'Refugio de montaña prefabricado, transportable por módulos. La pieza vuela sobre la ladera para minimizar el contacto con el terreno.',
  },
];
