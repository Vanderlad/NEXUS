// Theme registry. The visual definitions live in theme.css as [data-theme=…]
// variable blocks — this file only describes them for the Settings gallery.
// `rgb` entries are RGB triplets ("r g b") fed to the preview card as --p1/2/3.

export const THEMES = [
  {
    id: 'nexus', name: 'Hologrid',
    tagline: 'Cyan-indigo holo HUD — the original NEXUS look.',
    rgb: ['34 211 238', '129 140 248', '192 132 252']
  },
  {
    id: 'crimson', name: 'Crimson Protocol',
    tagline: 'Red-alert ops deck with a fast ember scanline.',
    rgb: ['251 113 133', '248 113 113', '251 146 60']
  },
  {
    id: 'emerald', name: 'Terminal',
    tagline: 'Green phosphor console — heavy grid, rapid scan.',
    rgb: ['74 222 128', '34 197 94', '163 230 53']
  },
  {
    id: 'synthwave', name: 'Sunset Drive',
    tagline: 'Pink-violet retrowave with slow neon auroras.',
    rgb: ['244 114 182', '192 132 252', '34 211 238']
  },
  {
    id: 'gold', name: 'Midas Circuit',
    tagline: 'Molten gold circuitry — warm and unhurried.',
    rgb: ['250 204 21', '245 158 11', '251 191 36']
  },
  {
    id: 'ice', name: 'Cryostasis',
    tagline: 'Glacial blues, near-still auroras, calm ops.',
    rgb: ['125 211 252', '165 180 252', '186 230 253']
  }
];

export const DEFAULT_THEME = 'nexus';

export const isTheme = (id) => THEMES.some(t => t.id === id);

export function applyTheme(id) {
  document.documentElement.dataset.theme = isTheme(id) ? id : DEFAULT_THEME;
}
