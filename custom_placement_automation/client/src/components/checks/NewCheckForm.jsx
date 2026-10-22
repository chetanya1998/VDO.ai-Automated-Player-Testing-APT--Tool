import { useEffect, useState } from 'react';
import { Alert, Button, FileInput, Input, Segmented, StatusPill, TextArea } from '../ui';
import { ArrowRightIcon } from '../ui/icons.jsx';
import { startPlacementCheck } from '../../api/placementChecks.js';
import { getSettings } from '../../api/settings.js';
import PlacementEventHelp from './PlacementEventHelp.jsx';
import { CHECK_TYPE } from '../../utils/checkTypes.js';

const DEVICES = ['desktop', 'mobile'];
const SOURCE_OPTIONS = [
  { value: 'file', label: 'Upload file' },
  { value: 'paste', label: 'Paste code' },
];

const CODE_DETAILS = {
  [CHECK_TYPE.JS]: {
    accept: '.js,text/javascript,application/javascript',
    effect: 'Replaces a.vdo.ai/core/<tag>/vdo.ai.js on every page checked.',
  },
  [CHECK_TYPE.CSS]: {
    accept: '.css,text/css',
    effect: "Injected into each page's <head> as it loads. The site's own vdo.ai.js runs unchanged.",
  },
};

const TYPE_CARDS = [
  { value: CHECK_TYPE.JS, title: 'Custom placement', description: 'Validate vdo.ai placement events' },
  { value: CHECK_TYPE.CSS, title: 'CSS check', description: 'Validate styles from style.css' },
];

const capitalize = (word) => word[0].toUpperCase() + word.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function FormSection({ step, title, children }) {
  return (
    <section className="form-section">
      <h3 className="form-section-title">
        <span className="step">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const parseUrls = (text) =>
  text
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

export default function NewCheckForm({ disabled, onStarted, prefill, onReset }) {
  const [type, setType] = useState(prefill?.type ?? CHECK_TYPE.JS);
  const [domain, setDomain] = useState(prefill?.domain ?? '');
  const [tag, setTag] = useState(prefill?.tag ?? '');
  const [devices, setDevices] = useState(prefill?.devices ?? DEVICES);
  const [urlsText, setUrlsText] = useState(prefill?.urls?.join('\n') ?? '');
  const [source, setSource] = useState('file');
  const [codeFile, setCodeFile] = useState(null);
  const [codeText, setCodeText] = useState('');
  const [scrollRatio, setScrollRatio] = useState(prefill?.scroll ? String(prefill.scroll.stepViewportRatio) : '');
  const [scrollInterval, setScrollInterval] = useState(prefill?.scroll ? String(prefill.scroll.intervalMs) : '');
  const [scrollLimits, setScrollLimits] = useState(null);
  const [urlTimeoutMs, setUrlTimeoutMs] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const urls = parseUrls(urlsText);
  const prefillType = prefill?.type ?? CHECK_TYPE.JS;
  const storedCode = prefill?.script && prefillType === type ? prefill.script : null;
  const details = CODE_DETAILS[type];
  const hasPrefilledScroll = Boolean(prefill?.scroll);

  useEffect(() => {
    getSettings()
      .then((settings) => {
        setScrollLimits(settings.scroll.limits);
        setUrlTimeoutMs(settings.urlTimeoutMs);
        if (hasPrefilledScroll) return;
        setScrollRatio(String(settings.scroll.stepViewportRatio));
        setScrollInterval(String(settings.scroll.intervalMs));
      })
      .catch(() => {});
  }, [hasPrefilledScroll]);

  const toggleDevice = (device) =>
    setDevices((current) => (current.includes(device) ? current.filter((d) => d !== device) : [...current, device]));

  function changeType(next) {
    setType(next);
    setCodeFile(null);
    setCodeText('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const pasting = source === 'paste';
    if (devices.length === 0) return setError('Pick at least one device.');
    if (urls.length === 0) return setError('Add at least one URL.');
    if (pasting && !codeText.trim()) return setError(`Paste the ${type} code to test.`);
    if (!pasting && !codeFile && !storedCode) return setError(`Choose the ${type} file to test.`);

    setSubmitting(true);
    try {
      const useStored = !pasting && !codeFile;
      const job = await startPlacementCheck({
        type,
        domain: domain.trim(),
        tag: tag.trim(),
        devices,
        urls,
        script: pasting ? codeText : codeFile ? await codeFile.text() : undefined,
        scriptId: useStored ? storedCode.id : undefined,
        scriptName: pasting ? type : (codeFile?.name ?? storedCode?.name),
        scroll: {
          stepViewportRatio: scrollRatio === '' ? undefined : Number(scrollRatio),
          intervalMs: scrollInterval === '' ? undefined : Number(scrollInterval),
        },
      });
      onStarted(job);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const busy = disabled || submitting;
  const shownFile = codeFile ?? (storedCode && { name: storedCode.name, size: storedCode.bytes });
  const limitSeconds = urlTimeoutMs ? Math.round(urlTimeoutMs / 1000) : 60;
  const ratioPercent = Number.isFinite(Number(scrollRatio)) && scrollRatio !== '' ? Math.round(Number(scrollRatio) * 100) : null;
  const summary = [
    type === CHECK_TYPE.JS ? 'Custom placement' : 'CSS check',
    devices.length ? devices.map(capitalize).join(' + ') : 'No device',
    plural(urls.length, 'URL'),
  ];

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>{prefill ? `Re-run: ${prefill.tag}` : 'New check'}</h2>
          <p>
            {prefill
              ? `Settings from the ${prefill.device} run of ${new Date(prefill.startedAt).toLocaleString()}.`
              : 'Set up a new placement validation run.'}
          </p>
        </div>
        <div className="panel-header-actions">
          {prefill && (
            <Button size="small" onClick={onReset} disabled={busy}>
              Start blank
            </Button>
          )}
        </div>
      </header>

      {prefill && !prefill.script && (
        <Alert tone="info">That run has no stored {prefillType}, so add it again below.</Alert>
      )}

      <form className="panel-form" onSubmit={handleSubmit}>
        <FormSection step="1" title="Check type">
          <div className="type-cards" role="radiogroup" aria-label="Check type">
            {TYPE_CARDS.map((card) => {
              const active = type === card.value;
              return (
                <button
                  key={card.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`type-card${active ? ' active' : ''}`}
                  onClick={() => !active && changeType(card.value)}
                  disabled={busy}
                >
                  <span className="radio-dot" />
                  <span className="type-card-text">
                    <strong>{card.title}</strong>
                    <span>{card.description}</span>
                  </span>
                  {active && <span className="active-tag">Active</span>}
                </button>
              );
            })}
          </div>

          {type === CHECK_TYPE.CSS && (
            <p className="form-note">
              The style is injected into each page; the site&apos;s vdo.ai.js runs unchanged. Only the wrapper is checked, and each
              URL stays open for the full {limitSeconds} s.
            </p>
          )}

          <div className="code-source">
            <div className="code-source-head">
              <span className="field-label">{type}</span>
              {type === CHECK_TYPE.JS && (
                <span className="field-hint source-help">
                  Must fire <code>vdo:placement</code> <PlacementEventHelp />
                </span>
              )}
              <Segmented options={SOURCE_OPTIONS} value={source} onChange={setSource} disabled={busy} />
            </div>
            {source === 'paste' ? (
              <TextArea
                id="code"
                aria-label={`${type} code`}
                hint={`Sent as ${type} (${(new Blob([codeText]).size / 1024).toFixed(1)} KB). ${details.effect}`}
                placeholder={`Paste the full contents of ${type} here`}
                rows={10}
                spellCheck={false}
                value={codeText}
                onChange={(e) => setCodeText(e.target.value)}
                disabled={busy}
              />
            ) : (
              <FileInput
                hint={!codeFile && storedCode ? 'Using the file from the earlier run. Choose a file to replace it.' : details.effect}
                accept={details.accept}
                file={shownFile}
                onChange={setCodeFile}
                disabled={busy}
              />
            )}
          </div>
        </FormSection>

        <FormSection step="2" title="Target site">
          <div className="form-row">
            <Input
              id="domain"
              label="Domain"
              placeholder="prabhatkhabar.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
              disabled={busy}
            />
            <Input
              id="tag"
              label="Tag name"
              placeholder="v-prabhatkhabar-v4"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              pattern="[\w-]+"
              title="Letters, numbers, _ and -"
              required
              disabled={busy}
            />
          </div>

          <div className="field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="urls">
                Site URLs
              </label>
              <span className="count-pill">{plural(urls.length, 'URL')} added</span>
            </div>
            <TextArea
              id="urls"
              placeholder={'https://www.prabhatkhabar.com/state/jharkhand\nhttps://www.prabhatkhabar.com/sports'}
              rows={4}
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              disabled={busy}
            />
          </div>
        </FormSection>

        <FormSection step="3" title="Run settings">
          <div className="settings-row">
            <div className="field">
              <span className="field-label">Devices</span>
              <div className="device-options">
                {DEVICES.map((device) => (
                  <label key={device} className={`device-option${devices.includes(device) ? ' checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={devices.includes(device)}
                      onChange={() => toggleDevice(device)}
                      disabled={busy}
                    />
                    {capitalize(device)}
                  </label>
                ))}
              </div>
            </div>

            <Input
              id="scroll-ratio"
              type="number"
              label="Scroll step"
              hint={ratioPercent !== null ? `${ratioPercent}% of viewport height` : 'Server default'}
              min={scrollLimits?.stepViewportRatio.min}
              max={scrollLimits?.stepViewportRatio.max}
              step="0.05"
              value={scrollRatio}
              onChange={(e) => setScrollRatio(e.target.value)}
              disabled={busy}
            />

            <div className="field">
              <label className="field-label" htmlFor="scroll-interval">
                Scroll interval
              </label>
              <div className="input-suffix">
                <input
                  id="scroll-interval"
                  className="input"
                  type="number"
                  min={scrollLimits?.intervalMs.min}
                  max={scrollLimits?.intervalMs.max}
                  step="100"
                  value={scrollInterval}
                  onChange={(e) => setScrollInterval(e.target.value)}
                  disabled={busy}
                />
                <span>ms</span>
              </div>
              <span className="field-hint">Wait between scroll steps</span>
            </div>
          </div>
        </FormSection>

        {error && <Alert tone="error">{error}</Alert>}

        <footer className="panel-footer">
          <div className="run-summary">
            {summary.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <Button type="submit" variant="primary" className="run-button" disabled={busy}>
            {submitting ? 'Starting…' : disabled ? 'Check running…' : 'Run check'}
            <ArrowRightIcon />
          </Button>
        </footer>
      </form>
    </section>
  );
}
