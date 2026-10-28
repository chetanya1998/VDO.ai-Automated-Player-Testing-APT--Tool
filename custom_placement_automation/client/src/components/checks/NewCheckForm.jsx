import { useEffect, useState } from 'react';
import { Alert, Button, FileInput, Input, Segmented, TextArea, Toggle } from '../ui';
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

const REFRESH_OPTIONS = [30, 45, 60].map((value) => ({ value, label: `${value} s` }));

function FormSection({ step, title, hint, className = '', children }) {
  return (
    <section className={`form-section form-block ${className}`.trim()}>
      <header className="form-block-head">
        <h3 className="form-section-title">
          <span className="step">{step}</span>
          {title}
        </h3>
        {hint && <p className="form-block-hint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

const parseUrls = (text) =>
  text
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

export default function NewCheckForm({ disabled, unavailable = false, deepEngine = null, onStarted, prefill, onReset }) {
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
  const [deepUrlTimeoutMs, setDeepUrlTimeoutMs] = useState(null);
  const [deep, setDeep] = useState(prefill?.deep ?? false);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(prefill?.refreshIntervalSec ?? null);
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
        setDeepUrlTimeoutMs(settings.deepUrlTimeoutMs ?? null);
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
    if ((deep || refreshIntervalSec) && deepEngine && !deepEngine.available) return setError(deepEngine.message);

    setSubmitting(true);
    try {
      const useStored = !pasting && !codeFile;
      const job = await startPlacementCheck({
        type,
        domain: domain.trim(),
        tag: tag.trim(),
        devices,
        urls,
        deep,
        refreshIntervalSec,
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
    ...(deep ? ['Deep test · 23 cases'] : []),
    ...(refreshIntervalSec ? [`Refresh check · ${refreshIntervalSec} s`] : []),
  ];
  const deepUnavailable = deepEngine !== null && !deepEngine.available;
  const deepSeconds = deepUrlTimeoutMs ? Math.round(deepUrlTimeoutMs / 1000) : 90;
  const deepRuns = urls.length * devices.length;

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
        <div className="form-grid">
        <FormSection step="1" title="What to test" hint="Pick the check type and add the code to apply on each page.">
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

        <FormSection step="2" title="Target site" hint="The publisher domain, its vdo.ai tag and the article URLs to open.">
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

        <FormSection step="3" title="Run settings" hint="Devices to emulate and how the page is scrolled to trigger lazy loading.">
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

        <FormSection step="4" title="Test depth" className={deep ? 'form-block-deep' : ''}>
          <Toggle
            id="deep-test"
            checked={deep}
            onChange={setDeep}
            disabled={busy || deepUnavailable}
            label="Automated player testing — deep"
            badge="23 cases"
            description={
              deep
                ? `After each placement check, the same page is opened again with your ${type} applied and all 23 player test cases are validated (tag, logger events, ads, viewability, devices). Adds up to ${deepSeconds} s per URL and device${deepRuns ? ` (${plural(deepRuns, 'deep run')} for this check)` : ''}.`
                : 'Off: only the placement check runs. Turn on to also validate all 23 player test cases on each URL, using your custom placement code.'
            }
          />
          {deepUnavailable && <Alert tone="warning">{deepEngine.message}</Alert>}
        </FormSection>

        <FormSection step="5" title="Ad slot refresh check" hint="Optional, separate from the deep test." className={refreshIntervalSec ? 'form-block-deep' : ''}>
          <Toggle
            id="refresh-check"
            checked={refreshIntervalSec !== null}
            onChange={(on) => setRefreshIntervalSec(on ? 30 : null)}
            disabled={busy || deepUnavailable}
            label="Check that the ad slot refreshes"
            description={
              refreshIntervalSec
                ? `After loading, the player is kept in view and the tool watches for a new ad request every ${refreshIntervalSec} s (on time = ${refreshIntervalSec - 5}–${refreshIntervalSec + 15} s). Adds about ${refreshIntervalSec + 20} s per URL and device.`
                : 'Off. Turn on to check that the player asks for a new ad at the publisher\'s refresh interval.'
            }
          />
          {refreshIntervalSec !== null && (
            <Segmented
              label="Refresh interval"
              options={REFRESH_OPTIONS}
              value={refreshIntervalSec}
              onChange={setRefreshIntervalSec}
              disabled={busy}
            />
          )}
        </FormSection>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <footer className="panel-footer">
          <div className="run-summary">
            {summary.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <Button type="submit" variant="primary" className="run-button" disabled={busy}>
            {submitting ? 'Starting…' : unavailable ? 'Waiting for backend readiness' : disabled ? 'Check running…' : 'Run check'}
            <ArrowRightIcon />
          </Button>
        </footer>
      </form>
    </section>
  );
}
