import { useEffect, useState } from 'react';

const LEGACY_CAPTIONS = ['Page as loaded', 'Player in view'];

export default function ScreenshotGallery({ screenshots, labels = [] }) {
  const caption = (i) => labels[i] ?? LEGACY_CAPTIONS[i] ?? `Screenshot ${i + 1}`;
  const [openIndex, setOpenIndex] = useState(null);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpenIndex(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex]);

  if (screenshots.length === 0) return <div className="shot-empty">No screenshots</div>;

  return (
    <>
      <div className="shots">
        {screenshots.map((src, i) => (
          <figure key={src} className="shot">
            <button type="button" onClick={() => setOpenIndex(i)} aria-label={`Open ${caption(i)}`}>
              <img src={src} alt={caption(i)} loading="lazy" />
            </button>
            <figcaption>{caption(i)}</figcaption>
          </figure>
        ))}
      </div>

      {openIndex !== null && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setOpenIndex(null)}>
          <img src={screenshots[openIndex]} alt={caption(openIndex)} />
        </div>
      )}
    </>
  );
}
