// DROP's own filters and effects. DROP-named recipes, not copies of
// Instagram / Snapchat / WhatsApp filters. Each filter is a CSS filter
// string applied to story / post media, saved with the record, and shown
// the same way to every viewer.

export interface StoryFilter {
  id: string;
  name: string;
  /** CSS filter() value applied to the media element. */
  css: string;
}

export const STORY_FILTERS: StoryFilter[] = [
  { id: 'original', name: 'Original', css: 'none' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.5) contrast(1.15) brightness(1.05)' },
  { id: 'warm', name: 'Warm', css: 'sepia(0.28) saturate(1.25) brightness(1.04)' },
  { id: 'cool', name: 'Cool', css: 'saturate(1.1) hue-rotate(-12deg) brightness(1.03)' },
  { id: 'bw', name: 'Black & White', css: 'grayscale(1) contrast(1.1)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.45) contrast(0.92) brightness(1.05) saturate(0.8)' },
  { id: 'golden', name: 'Golden', css: 'sepia(0.35) saturate(1.4) brightness(1.08) contrast(1.05)' },
  { id: 'soft', name: 'Soft', css: 'brightness(1.1) contrast(0.92) saturate(0.9) blur(0.3px)' },
  { id: 'clarity', name: 'Clarity', css: 'contrast(1.25) saturate(1.15) brightness(1.02)' },
  { id: 'faded', name: 'Faded', css: 'contrast(0.85) brightness(1.12) saturate(0.75)' },
  { id: 'ember', name: 'Ember', css: 'sepia(0.5) saturate(1.6) hue-rotate(-15deg) contrast(1.1)' },
  { id: 'honey', name: 'Honey', css: 'sepia(0.3) saturate(1.35) brightness(1.1) contrast(1.02)' },
  { id: 'chrome', name: 'Chrome', css: 'grayscale(0.7) contrast(1.3) brightness(1.05)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.95)' },
  { id: 'neon', name: 'Neon', css: 'saturate(2) contrast(1.2) brightness(1.05) hue-rotate(8deg)' },
  { id: 'dusk', name: 'Dusk', css: 'brightness(0.9) saturate(1.2) hue-rotate(-20deg) contrast(1.1)' },
  { id: 'dawn', name: 'Dawn', css: 'brightness(1.12) sepia(0.2) saturate(1.2) contrast(0.98)' },
  { id: 'mist', name: 'Mist', css: 'brightness(1.08) contrast(0.88) saturate(0.85) blur(0.4px)' },
  { id: 'emberglow', name: 'Ember Glow', css: 'sepia(0.55) saturate(1.7) brightness(1.06) contrast(1.08)' },
  { id: 'lagoon', name: 'Lagoon', css: 'saturate(1.3) hue-rotate(18deg) brightness(1.04) contrast(1.05)' },
  { id: 'rose', name: 'Rose', css: 'sepia(0.18) saturate(1.3) hue-rotate(-25deg) brightness(1.05)' },
  { id: 'forest', name: 'Forest', css: 'saturate(1.25) hue-rotate(25deg) contrast(1.08) brightness(0.98)' },
  { id: 'sand', name: 'Sand', css: 'sepia(0.4) brightness(1.1) contrast(0.95) saturate(0.9)' },
  { id: 'midnight', name: 'Midnight', css: 'brightness(0.85) contrast(1.2) saturate(1.15) hue-rotate(-10deg)' },
  { id: 'candy', name: 'Candy', css: 'saturate(1.8) brightness(1.08) contrast(1.05)' },
  { id: 'silver', name: 'Silver', css: 'grayscale(0.85) brightness(1.12) contrast(1.05)' },
  { id: 'copper', name: 'Copper', css: 'sepia(0.6) saturate(1.4) hue-rotate(-20deg) brightness(1.05)' },
  { id: 'aqua', name: 'Aqua', css: 'saturate(1.35) hue-rotate(35deg) brightness(1.05)' },
  { id: 'velvet', name: 'Velvet', css: 'contrast(1.15) brightness(0.95) saturate(1.2) sepia(0.12)' },
  { id: 'sunbeam', name: 'Sunbeam', css: 'brightness(1.15) saturate(1.3) sepia(0.15) contrast(1.0)' },
  { id: 'storm', name: 'Storm', css: 'brightness(0.92) contrast(1.25) saturate(0.9) hue-rotate(10deg)' },
  { id: 'blush', name: 'Blush', css: 'sepia(0.15) saturate(1.25) hue-rotate(-30deg) brightness(1.06)' },
];

export function filterById(id: string): StoryFilter {
  return STORY_FILTERS.find((f) => f.id === id) ?? STORY_FILTERS[0];
}

export function filterCss(id: string): string {
  return filterById(id).css;
}

export interface StoryEffect {
  id: string;
  name: string;
  category: 'For You' | 'Spotlight' | 'Real-time' | 'Personalized' | 'Film';
  /** Extra CSS applied on top of the chosen filter. */
  css: string;
}

export const STORY_EFFECTS: StoryEffect[] = [
  { id: 'back-flash', name: 'Back Flash', category: 'Spotlight', css: 'brightness(1.2) contrast(1.2)' },
  { id: 'ghostly', name: 'Ghostly', category: 'For You', css: 'opacity(0.9) brightness(1.15) blur(0.3px)' },
  { id: 'vi-sunset', name: 'VI Sunset', category: 'Spotlight', css: 'sepia(0.4) saturate(1.5) hue-rotate(-18deg) brightness(1.06)' },
  { id: 'down-lighting', name: 'Down Lighting', category: 'Real-time', css: 'brightness(0.9) contrast(1.25)' },
  { id: 'fire', name: 'Fire', category: 'For You', css: 'sepia(0.5) saturate(1.8) hue-rotate(-22deg) contrast(1.15)' },
  { id: 'halo', name: 'Halo', category: 'Personalized', css: 'brightness(1.18) saturate(1.1)' },
  { id: 'prism', name: 'Prism', category: 'Real-time', css: 'saturate(1.7) hue-rotate(25deg) contrast(1.1)' },
  { id: 'grain', name: 'Grain', category: 'Film', css: 'contrast(1.15) brightness(0.98) saturate(0.9)' },
  { id: 'super8', name: 'Super 8', category: 'Film', css: 'sepia(0.5) contrast(0.95) brightness(1.05)' },
  { id: 'noir-film', name: 'Noir Film', category: 'Film', css: 'grayscale(1) contrast(1.4) brightness(0.92)' },
  { id: 'glow', name: 'Glow', category: 'Spotlight', css: 'brightness(1.15) saturate(1.2) blur(0.2px)' },
  { id: 'frost', name: 'Frost', category: 'Real-time', css: 'brightness(1.1) saturate(0.8) hue-rotate(15deg) contrast(0.95)' },
  { id: 'ember-flare', name: 'Ember Flare', category: 'Spotlight', css: 'sepia(0.45) saturate(1.6) brightness(1.08)' },
  { id: 'tide', name: 'Tide', category: 'Personalized', css: 'saturate(1.3) hue-rotate(30deg) brightness(1.04)' },
  { id: 'aurora', name: 'Aurora', category: 'For You', css: 'saturate(1.6) hue-rotate(45deg) brightness(1.05)' },
  { id: 'vignette', name: 'Vignette', category: 'Film', css: 'brightness(0.95) contrast(1.2)' },
  { id: 'dream', name: 'Dream', category: 'For You', css: 'brightness(1.12) saturate(0.9) blur(0.5px)' },
  { id: 'pulse', name: 'Pulse', category: 'Real-time', css: 'saturate(1.9) contrast(1.15) brightness(1.04)' },
  { id: 'mono-pop', name: 'Mono Pop', category: 'Personalized', css: 'grayscale(0.5) contrast(1.3) brightness(1.05)' },
  { id: 'gold-rush', name: 'Gold Rush', category: 'Spotlight', css: 'sepia(0.5) saturate(1.5) brightness(1.1)' },
  { id: 'dusk-fall', name: 'Dusk Fall', category: 'Film', css: 'brightness(0.88) saturate(1.2) hue-rotate(-25deg) contrast(1.12)' },
  { id: 'spark', name: 'Spark', category: 'For You', css: 'brightness(1.18) contrast(1.18) saturate(1.3)' },
];

export function effectById(id: string): StoryEffect | null {
  return STORY_EFFECTS.find((e) => e.id === id) ?? null;
}

export const EFFECT_CATEGORIES = [
  'For You',
  'Spotlight',
  'Real-time',
  'Personalized',
  'Film',
] as const;
