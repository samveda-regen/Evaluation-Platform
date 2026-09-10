import { useEffect, useRef, useState } from 'react';

/**
 * Auto-advancing slideshow of environment-setup guidance, shown on the pre-exam
 * instructions page. Slides are the image files in
 * `src/assets/instruction-slides/` — drop numbered files in there (see the
 * README) and they appear here in filename order. If the folder is empty this
 * component renders nothing.
 */
const slideModules = import.meta.glob(
  '../assets/instruction-slides/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}',
  { eager: true, import: 'default' },
) as Record<string, string>;

const SLIDES: string[] = Object.keys(slideModules)
  .sort()
  .map((key) => slideModules[key]);

const ADVANCE_MS = 5000;
const FADE_MS = 600;

export default function InstructionSlideshow() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (SLIDES.length <= 1 || paused) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, ADVANCE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [paused]);

  if (SLIDES.length === 0) return null;

  return (
    <div className="mt-6">
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: 'var(--admin-text-subtle)' }}
      >
        Set up your space
      </p>

      <div
        className="relative rounded-xl overflow-hidden border"
        style={{ borderColor: 'var(--admin-border-soft)', background: '#F1F5F9' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div className="relative w-full" style={{ aspectRatio: '2 / 1' }}>
          {SLIDES.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`Environment setup guideline ${i + 1} of ${SLIDES.length}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
              style={{
                opacity: i === index ? 1 : 0,
                transition: reduceMotion ? 'none' : `opacity ${FADE_MS}ms ease-in-out`,
              }}
            />
          ))}
        </div>
      </div>

      {SLIDES.length > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          {SLIDES.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`Show guideline ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                background: i === index ? 'var(--admin-accent)' : 'rgba(148,163,184,0.55)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
