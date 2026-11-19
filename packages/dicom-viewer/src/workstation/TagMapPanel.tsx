import { Fragment, useEffect, useId, useMemo, useState, type ReactElement } from 'react';

import { useWorkstation } from './context';
import { downloadBlob } from './exportImage';
import { Icon } from './icons';
import { countTagNodes, filterTagNodes, readTagMap, tagNodesToJson, type TagNode } from './tagMap';

type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; nodes: TagNode[] };

/** The Map tab: every DICOM attribute of the image in the active viewport. */
export function TagMapPanel(): ReactElement {
  const { session, state, views, labels, allowPatientInfo } = useWorkstation();
  const cell = state.cells.find((item) => item.id === state.activeCellId) ?? state.cells[0]!;
  const current = session.getCellImage(cell.id);
  const instances = session.getInstances(cell.seriesInstanceUid);
  // The image follows the active viewport until the user picks another file.
  const [pickedIndex, setPickedIndex] = useState<number>();
  useEffect(() => setPickedIndex(undefined), [cell.id, cell.seriesInstanceUid, views[cell.id]?.status?.imageIndex]);
  const currentIndex = current ? instances.indexOf(current.instance) : -1;
  const index = pickedIndex ?? (currentIndex >= 0 ? currentIndex : 0);
  const file = instances[index]?.file;
  const redact = !allowPatientInfo || !state.patientInfo;

  const [load, setLoad] = useState<LoadState>({ kind: 'idle' });
  useEffect(() => {
    if (!file) {
      setLoad({ kind: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    readTagMap(file, { signal: controller.signal, redactPatientData: redact }).then(
      (nodes) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', nodes });
      },
      () => {
        if (!controller.signal.aborted) setLoad({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [file, redact]);

  const [query, setQuery] = useState('');
  const [hidePrivate, setHidePrivate] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string>();
  const searchId = useId();

  const nodes = load.kind === 'ready' ? load.nodes : [];
  const visibleNodes = useMemo(() => {
    const base = hidePrivate ? nodes.filter((node) => !node.isPrivate) : nodes;
    return filterTagNodes(base, query);
  }, [nodes, query, hidePrivate]);
  const total = useMemo(() => countTagNodes(nodes), [nodes]);
  const shown = useMemo(() => countTagNodes(visibleNodes), [visibleNodes]);

  const allSequencePaths = useMemo(() => {
    const paths: string[] = [];
    const walk = (list: readonly TagNode[], prefix: string) => {
      list.forEach((node, position) => {
        const path = `${prefix}/${position}`;
        if (node.items) {
          paths.push(path);
          node.items.forEach((item, itemIndex) => walk(item, `${path}.${itemIndex}`));
        }
      });
    };
    walk(visibleNodes, '');
    return paths;
  }, [visibleNodes]);

  const copy = async (node: TagNode, path: string) => {
    try {
      await navigator.clipboard.writeText(`${node.tag} ${node.name}: ${node.value}`);
      setCopied(path);
      setTimeout(() => setCopied((value) => (value === path ? undefined : value)), 1200);
    } catch {
      // Clipboard not available.
    }
  };

  const renderRows = (list: readonly TagNode[], depth: number, prefix: string): ReactElement[] =>
    list.map((node, position) => {
      const path = `${prefix}/${position}`;
      const isOpen = !collapsed.has(path) || query.trim() !== '';
      return (
        <Fragment key={path}>
          <tr data-depth={depth} data-private={node.isPrivate || undefined} data-sequence={node.items ? true : undefined}>
            <td className="mihawk-ws-map-tag" style={{ paddingInlineStart: `${0.5 + depth * 1.1}rem` }}>
              {node.items ? (
                <button
                  type="button"
                  className="mihawk-ws-map-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${node.name} ${node.tag}`}
                  onClick={() =>
                    setCollapsed((value) => {
                      const next = new Set(value);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                >
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                  <code>{node.tag}</code>
                </button>
              ) : (
                <code>{node.tag}</code>
              )}
            </td>
            <td className="mihawk-ws-map-name">{node.name}</td>
            <td className="mihawk-ws-map-vr">
              <code>{node.vr}</code>
            </td>
            <td className="mihawk-ws-map-value">
              {node.redacted ? <span className="mihawk-ws-muted">{labels.mapRedacted}</span> : <span>{node.value}</span>}
              {!node.items && !node.redacted && node.value && (
                <button
                  type="button"
                  className="mihawk-ws-map-copy"
                  aria-label={`${labels.mapCopy} ${node.name}`}
                  title={copied === path ? labels.mapCopied : labels.mapCopy}
                  onClick={() => void copy(node, path)}
                >
                  <Icon name="copy" size={14} />
                </button>
              )}
            </td>
          </tr>
          {node.items &&
            isOpen &&
            node.items.map((item, itemIndex) => (
              <Fragment key={`${path}.${itemIndex}`}>
                <tr className="mihawk-ws-map-item" data-depth={depth + 1}>
                  <td colSpan={4} style={{ paddingInlineStart: `${0.5 + (depth + 1) * 1.1}rem` }}>
                    {labels.mapItem(itemIndex + 1)}
                  </td>
                </tr>
                {renderRows(item, depth + 1, `${path}.${itemIndex}`)}
              </Fragment>
            ))}
        </Fragment>
      );
    });

  const series = current?.series ?? session.getSeries(cell.seriesInstanceUid);
  const seriesLabel = series
    ? labels.seriesLabel({ number: series.seriesNumber, description: series.description, modality: series.modality }) ||
      labels.untitledSeries
    : '';

  return (
    <section className="mihawk-ws-map" aria-label={labels.mapHeading} data-testid="mihawk-ws-map">
      <header className="mihawk-ws-map-header">
        <div className="mihawk-ws-map-title">
          <h2>{labels.mapHeading}</h2>
          {file && <p className="mihawk-ws-muted">{labels.mapSource(seriesLabel, index + 1, instances.length)}</p>}
        </div>
        {file && (
          <div className="mihawk-ws-map-tools">
            <label className="mihawk-ws-map-search" htmlFor={searchId}>
              <Icon name="search" size={16} />
              <span className="mihawk-ws-visually-hidden">{labels.mapSearch}</span>
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder={labels.mapSearchPlaceholder}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            {instances.length > 1 && (
              <label className="mihawk-ws-map-instance">
                <span>{labels.mapInstance}</span>
                <input
                  type="number"
                  min={1}
                  max={instances.length}
                  value={index + 1}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) setPickedIndex(Math.min(instances.length, Math.max(1, value)) - 1);
                  }}
                />
                <span className="mihawk-ws-muted">/ {instances.length}</span>
              </label>
            )}
            <label className="mihawk-ws-toggle mihawk-ws-toggle-inline">
              <input type="checkbox" checked={hidePrivate} onChange={(event) => setHidePrivate(event.currentTarget.checked)} />
              <span>{labels.mapHidePrivate}</span>
            </label>
            <button type="button" className="mihawk-ws-action" onClick={() => setCollapsed(new Set())}>
              {labels.mapExpandAll}
            </button>
            <button type="button" className="mihawk-ws-action" onClick={() => setCollapsed(new Set(allSequencePaths))}>
              {labels.mapCollapseAll}
            </button>
            <button
              type="button"
              className="mihawk-ws-action"
              disabled={load.kind !== 'ready'}
              onClick={() =>
                downloadBlob(
                  new Blob([JSON.stringify(tagNodesToJson(visibleNodes), null, 2)], { type: 'application/json' }),
                  'dicom-tags.json',
                )
              }
            >
              <Icon name="download" size={16} />
              <span>{labels.mapExportJson}</span>
            </button>
          </div>
        )}
      </header>

      {!file && <p className="mihawk-ws-map-empty">{labels.mapNoImage}</p>}
      {file && load.kind === 'loading' && <p className="mihawk-ws-map-empty" role="status">{labels.mapLoading}</p>}
      {file && load.kind === 'error' && <p className="mihawk-ws-map-empty" role="alert">{labels.mapFailed}</p>}
      {file && load.kind === 'ready' && (
        <>
          <p className="mihawk-ws-map-count mihawk-ws-muted" role="status">
            {labels.mapCount(shown, total)} · {labels.mapPrivacyNote}
          </p>
          <div className="mihawk-ws-map-table-wrap">
            {visibleNodes.length === 0 ? (
              <p className="mihawk-ws-map-empty">{labels.mapNoMatches}</p>
            ) : (
              <table className="mihawk-ws-map-table">
                <thead>
                  <tr>
                    <th scope="col">{labels.mapColumns.tag}</th>
                    <th scope="col">{labels.mapColumns.name}</th>
                    <th scope="col">{labels.mapColumns.vr}</th>
                    <th scope="col">{labels.mapColumns.value}</th>
                  </tr>
                </thead>
                <tbody>{renderRows(visibleNodes, 0, '')}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
