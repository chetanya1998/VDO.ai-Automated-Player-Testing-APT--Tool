import { useEffect, useState } from 'react';
import { Alert, Button, Table } from '../ui';
import { SearchIcon } from '../ui/icons.jsx';
import RunResults from '../checks/RunResults.jsx';
import { clearHistory, deleteRun, getRun, listRuns, runPdfUrl } from '../../api/history.js';
import { formatDateTime, formatElapsed, formatStarted, runStatus } from '../../utils/format.js';
import { CHECK_TYPE, checkTypeName } from '../../utils/checkTypes.js';

const PAGE_SIZE = 20;

const STATUS_LABELS = { pass: 'Passed', fail: 'Failed', error: 'Error' };

const FILTERS = [
  { value: '', label: 'All runs' },
  { value: 'status:pass', label: 'Placement passed' },
  { value: 'status:fail', label: 'Placement failed' },
  { value: 'status:error', label: 'Placement errors' },
  { value: `type:${CHECK_TYPE.JS}`, label: 'Custom placement' },
  { value: `type:${CHECK_TYPE.CSS}`, label: 'CSS checks' },
  { value: `type:${CHECK_TYPE.STICKY}`, label: 'Sticky checks' },
  { value: 'mode:deep', label: 'Deep tests' },
];

const BASE_COLUMNS = [
  {
    key: 'status',
    header: 'Result',
    render: (run) => {
      const status = runStatus(run);
      return <span className={`status-dot status-${status}`}>{STATUS_LABELS[status]}</span>;
    },
  },
  {
    key: 'type',
    header: 'Check type',
    render: (run) => (
      <span className="domain-cell">
        {checkTypeName(run.type)}
        {run.refreshIntervalSec && <small>+ refresh check · {run.refreshIntervalSec} s</small>}
        {(run.stickySummary?.perUrl ?? []).slice(0, 3).map((item, i, all) => (
          <small key={`${item.url}-${i}`}>
            {all.length > 1 ? `URL ${i + 1}: ` : ''}
            {item.overallVerdict === 'PASS' ? (item.review ? 'Pass · review' : 'Pass') : item.overallVerdict === 'FAIL' ? 'Fail' : 'Not judged'}
            {Number.isFinite(item.passShare) ? ` · ${Math.round(item.passShare * 100)}% passed` : ''} · {item.verdictCounts?.FAIL ?? 0} fail of {item.total ?? 25}
          </small>
        ))}
      </span>
    ),
  },
  {
    key: 'domain',
    header: 'Domain',
    render: (run) => (
      <span className="domain-cell">
        {run.domain}
        <small>{run.tag}</small>
        {run.offDomainUrls?.length > 0 && <small className="text-warn">+ staging / preview URLs</small>}
      </span>
    ),
  },
  {
    key: 'mode',
    header: 'Deep test (23 cases per URL)',
    render: (run) => {
      if (run.type === CHECK_TYPE.STICKY) return <span className="muted">—</span>;
      if (!run.deep) return <span className="muted">Not run</span>;
      const perUrl = run.deepSummary?.perUrl ?? [];
      if (perUrl.length === 0) return <span className="depth-tag">Deep</span>;
      // One entry per URL, never summed across URLs.
      const shown = perUrl.slice(0, 3);
      return (
        <span className="depth-cell">
          {shown.map((item, i) => (
            <small key={`${item.url}-${i}`}>
              {perUrl.length > 1 ? `URL ${i + 1}: ` : ''}
              {item.verdictCounts?.PASS ?? 0}/23 passed · {item.verdictCounts?.FAIL ?? 0} failed
            </small>
          ))}
          {perUrl.length > shown.length && <small>+{perUrl.length - shown.length} more URLs</small>}
        </span>
      );
    },
  },
  { key: 'device', header: 'Devices', render: (run) => run.device[0].toUpperCase() + run.device.slice(1) },
  { key: 'startedAt', header: 'Started', render: (run) => <time title={formatDateTime(run.startedAt)}>{formatStarted(run.startedAt)}</time> },
  {
    key: 'duration',
    header: 'Duration',
    render: (run) => formatElapsed(new Date(run.finishedAt) - new Date(run.startedAt)),
  },
];

const toRerunSettings = (run) => ({
  key: `${run.id}-${Date.now()}`,
  type: run.type ?? CHECK_TYPE.JS,
  domain: run.domain,
  tag: run.tag,
  device: run.device,
  devices: [run.device],
  urls: run.results.map((result) => result.url),
  scroll: run.scroll ?? null,
  script: run.script ?? null,
  deep: run.deep === true,
  refreshIntervalSec: run.refreshIntervalSec ?? null,
  stickyCode: run.stickyCode ?? 'none',
  stickyAdditional: run.stickyAdditional === true,
  allowOtherDomains: run.allowOtherDomains === true,
  startedAt: run.startedAt,
});

export default function HistorySection({ refreshKey, onRerun }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ runs: [], total: 0 });
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const [reloadCount, setReloadCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const requestKey = `${page}:${refreshKey}:${reloadCount}:${debouncedQuery}:${filter}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    const [filterKind, filterValue] = filter.split(':');
    listRuns({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery,
      status: filterKind === 'status' ? filterValue : '',
      type: filterKind === 'type' ? filterValue : '',
      mode: filterKind === 'mode' ? filterValue : '',
    })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoadedKey(requestKey));
    return () => {
      cancelled = true;
    };
  }, [page, debouncedQuery, filter, requestKey]);

  async function openRun(run) {
    if (selected?.id === run.id) return setSelected(null);
    setSelectedLoading(true);
    try {
      setSelected(await getRun(run.id));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSelectedLoading(false);
    }
  }

  async function rerun(run) {
    setBusy(true);
    try {
      const full = selected?.id === run.id ? selected : await getRun(run.id);
      onRerun(toRerunSettings(full));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRun(run) {
    if (!window.confirm(`Delete the ${run.tag} (${run.device}) run from ${formatDateTime(run.startedAt)} and its screenshots?`)) return;
    setBusy(true);
    try {
      await deleteRun(run.id);
      if (selected?.id === run.id) setSelected(null);
      if (data.runs.length === 1 && page > 1) setPage((p) => p - 1);
      else setReloadCount((n) => n + 1);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!window.confirm(`Delete all ${data.total} runs and every screenshot? This can't be undone.`)) return;
    setBusy(true);
    try {
      await clearHistory();
      setSelected(null);
      setPage(1);
      setReloadCount((n) => n + 1);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    ...BASE_COLUMNS,
    {
      key: 'actions',
      header: '',
      className: 'actions',
      render: (run) => (
        <div className="row-actions">
          <Button
            size="small"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              rerun(run);
            }}
          >
            Re-run
          </Button>
          <a className="btn btn-small" href={runPdfUrl(run.id)} download onClick={(e) => e.stopPropagation()}>
            PDF
          </a>
          <Button
            variant="danger"
            size="small"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              removeRun(run);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const shownFrom = data.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const shownTo = (page - 1) * PAGE_SIZE + data.runs.length;
  const filtered = Boolean(debouncedQuery || filter);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>Recent runs</h2>
          <p>Review placement check results and activity.</p>
        </div>
        <div className="panel-header-actions">
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search runs"
              aria-label="Search runs by tag, domain or URL"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            className="filter-select"
            aria-label="Filter runs"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value ? option.label : 'Filter'}
              </option>
            ))}
          </select>
          <Button variant="danger" size="small" onClick={removeAll} disabled={busy || loading || data.total === 0 || filtered}>
            Clear
          </Button>
        </div>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <Table
        columns={columns}
        rows={data.runs}
        onRowClick={openRun}
        selectedKey={selected?.id}
        empty={loading ? 'Loading…' : filtered ? 'No runs match this search.' : 'No runs yet. Finished checks appear here.'}
      />

      <footer className="table-footer">
        <span className="muted">
          {loading ? 'Loading…' : data.total ? `Showing ${shownFrom}–${shownTo} of ${data.total} runs` : 'No runs'}
        </span>
        {pageCount > 1 && (
          <div className="pagination">
            <Button size="small" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
              ← Previous
            </Button>
            <span className="muted">
              {page} / {pageCount}
            </span>
            <Button size="small" onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount || loading}>
              Next →
            </Button>
          </div>
        )}
      </footer>

      {selectedLoading && <p className="muted">Loading run…</p>}
      {selected && !selectedLoading && (
        <div className="history-detail">
          <div className="history-detail-actions">
            <Button onClick={() => rerun(selected)} disabled={busy}>
              Re-run
            </Button>
            <a className="btn" href={runPdfUrl(selected.id)} download>
              Download PDF
            </a>
            <Button onClick={() => setSelected(null)}>Close</Button>
          </div>
          <RunResults run={selected} />
        </div>
      )}
    </section>
  );
}
