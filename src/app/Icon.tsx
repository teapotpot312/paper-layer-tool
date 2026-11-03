const P: Record<string, string> = {
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  clean: 'M15 4l5 5M13.5 5.5l5 5L9 20H4v-5z',
  stack: 'M4 15h16v4H4zM6 10h12v4H6zM8 5h8v4H8z',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  play: 'M6 4l14 8-14 8z',
  save: 'M5 3h11l5 5v13H3V3zM7 3v6h8V3M7 21v-7h10v7',
  open: 'M3 7h6l2 2h10v11H3zM3 7V4h6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  image: 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  printer: 'M6 9V2h12v7M6 18H4v-7h16v7h-2M6 14h12v8H6z',
  file: 'M14 2H6v20h12V6zM14 2v4h4M8 13h8M8 17h8',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  warn: 'M12 3 2 21h20L12 3zM12 10v5M12 18h.01',
};

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  );
}
