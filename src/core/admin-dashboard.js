/**
 * Interactive Admin Visualization Dashboard using Recharts
 * Visualizes webhook logs, button callback triggers, failure patterns,
 * and processing latency.
 */

export function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hendy Server PRO — Webhook & Callback Analytics</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 50: '#f0fdf4', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
            darkBg: '#0b0f17',
            cardBg: '#131b2e',
            borderClr: '#1e293b'
          }
        }
      }
    };
  </script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.min.js"></script>
  <style>
    body { background-color: #0b0f17; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .glass-card { background: rgba(19, 27, 46, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); }
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
  </style>
</head>
<body class="min-h-screen">
  <div id="root"></div>

  <script>
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;
    const {
      ResponsiveContainer,
      PieChart,
      Pie,
      Cell,
      BarChart,
      Bar,
      XAxis,
      YAxis,
      Tooltip,
      Legend,
      AreaChart,
      Area,
      CartesianGrid
    } = window.Recharts || {};

    const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7'];

    function App() {
      const [token, setToken] = useState(() => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('token') || localStorage.getItem('hendy_admin_token') || '';
      });
      const [inputToken, setInputToken] = useState(token);
      const [traces, setTraces] = useState([]);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      const [autoRefresh, setAutoRefresh] = useState(true);
      const [selectedFilter, setSelectedFilter] = useState('all');
      const [expandedTrace, setExpandedTrace] = useState(null);

      const fetchLogs = useCallback(async (authToken) => {
        if (!authToken) return;
        setLoading(true);
        setError(null);
        try {
          const res = await fetch('/api/admin/webhook-logs?limit=100', {
            headers: { 'Authorization': 'Bearer ' + authToken }
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Failed to fetch webhook traces (HTTP ' + res.status + ')');
          }
          setTraces(data.traces || []);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        if (token) {
          localStorage.setItem('hendy_admin_token', token);
          fetchLogs(token);
        }
      }, [token, fetchLogs]);

      useEffect(() => {
        if (!autoRefresh || !token) return;
        const interval = setInterval(() => fetchLogs(token), 4000);
        return () => clearInterval(interval);
      }, [autoRefresh, token, fetchLogs]);

      const handleTokenSubmit = (e) => {
        e.preventDefault();
        setToken(inputToken.trim());
      };

      // Aggregations
      const analytics = useMemo(() => {
        let totalIncoming = 0;
        let totalCallbacks = 0;
        let successfulCallbacks = 0;
        let failedCallbacks = 0;
        let rejectedSignatures = 0;
        let unmatchedCallbacks = 0;
        let totalDuration = 0;
        let durationCount = 0;

        const buttonMap = {};
        const failureMap = {};
        const timeline = [];

        // Traces come newest first, reverse for chronological timeline
        const chronological = [...traces].reverse();

        for (const t of chronological) {
          if (t.event === 'incoming') {
            totalIncoming++;
            if (t.summary?.type === 'callback_query') {
              totalCallbacks++;
              const btn = t.summary?.data || 'unknown';
              if (!buttonMap[btn]) buttonMap[btn] = { action: btn, success: 0, failure: 0 };
            }
          } else if (t.event === 'processed') {
            if (t.durationMs !== undefined) {
              totalDuration += t.durationMs;
              durationCount++;
              timeline.push({
                time: new Date(t.timestamp).toLocaleTimeString(),
                durationMs: t.durationMs,
                updateId: t.updateId
              });
            }
          } else if (t.event === 'rejected') {
            const reason = t.reason || 'unspecified_rejection';
            failureMap[reason] = (failureMap[reason] || 0) + 1;
            if (reason.includes('signature') || reason.includes('secret')) {
              rejectedSignatures++;
            }
          } else if (t.event === 'error') {
            const errType = t.error ? t.error.slice(0, 30) : 'runtime_error';
            failureMap[errType] = (failureMap[errType] || 0) + 1;
            failedCallbacks++;
          }
        }

        // Correlate button successes
        for (const t of traces) {
          if (t.summary?.type === 'callback_query') {
            const btn = t.summary?.data || 'unknown';
            if (buttonMap[btn]) {
              if (t.event === 'error') buttonMap[btn].failure++;
              else buttonMap[btn].success++;
            }
          }
        }

        const buttonChartData = Object.values(buttonMap).slice(0, 8);
        const failureChartData = Object.entries(failureMap).map(([reason, count]) => ({ reason, count }));

        const outcomeChartData = [
          { name: 'Success', value: durationCount || 1, color: '#22c55e' },
          { name: 'Invalid Signature', value: rejectedSignatures, color: '#ef4444' },
          { name: 'Handler Errors', value: failedCallbacks, color: '#f59e0b' },
          { name: 'Other Rejections', value: Math.max(0, Object.keys(failureMap).length - rejectedSignatures), color: '#3b82f6' }
        ].filter(item => item.value > 0);

        return {
          totalIncoming,
          totalCallbacks,
          successfulCallbacks: durationCount,
          rejectedSignatures,
          failedCallbacks,
          avgLatency: durationCount ? Math.round(totalDuration / durationCount) : 0,
          buttonChartData,
          failureChartData,
          outcomeChartData,
          timeline: timeline.slice(-20)
        };
      }, [traces]);

      // Filtered traces
      const filteredTraces = useMemo(() => {
        if (selectedFilter === 'all') return traces;
        if (selectedFilter === 'callback_query') return traces.filter(t => t.summary?.type === 'callback_query');
        if (selectedFilter === 'errors') return traces.filter(t => t.event === 'error' || t.event === 'rejected');
        if (selectedFilter === 'rejected_sig') return traces.filter(t => t.reason?.includes('signature') || t.reason?.includes('secret'));
        return traces;
      }, [traces, selectedFilter]);

      if (!token) {
        return h('div', { class: 'flex items-center justify-center min-h-screen p-4' },
          h('div', { class: 'glass-card p-8 rounded-2xl max-w-md w-full shadow-2xl border border-slate-700/60' },
            h('div', { class: 'flex items-center space-x-3 mb-6' },
              h('div', { class: 'w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xl' }, '⚡'),
              h('div', null,
                h('h1', { class: 'text-xl font-bold tracking-tight text-white' }, 'Hendy Server PRO V2'),
                h('p', { class: 'text-xs text-slate-400' }, 'Webhook & Callback Failure Analytics')
              )
            ),
            h('p', { class: 'text-sm text-slate-300 mb-4' }, 'Enter your ADMIN_API_TOKEN to authenticate and visualize real-time Telegram webhook failure patterns:'),
            h('form', { onSubmit: handleTokenSubmit, class: 'space-y-4' },
              h('input', {
                type: 'password',
                value: inputToken,
                onChange: (e) => setInputToken(e.target.value),
                placeholder: 'Paste ADMIN_API_TOKEN...',
                class: 'w-full px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500'
              }),
              h('button', {
                type: 'submit',
                class: 'w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition font-medium text-sm text-white shadow-lg shadow-emerald-900/30'
              }, 'Access Analytics Dashboard')
            )
          )
        );
      }

      return h('div', { class: 'p-4 md:p-8 max-w-7xl mx-auto space-y-6' },
        // Top Header
        h('header', { class: 'flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6 rounded-2xl' },
          h('div', { class: 'flex items-center space-x-4' },
            h('div', { class: 'w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl font-bold' }, '📊'),
            h('div', null,
              h('h1', { class: 'text-2xl font-bold tracking-tight text-white' }, 'Webhook & Callback Analytics'),
              h('p', { class: 'text-xs text-slate-400' }, 'Monitoring Telegram webhook update payloads, button triggers & failure patterns')
            )
          ),
          h('div', { class: 'flex flex-wrap items-center gap-3' },
            h('button', {
              onClick: () => setAutoRefresh(!autoRefresh),
              class: 'px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ' +
                (autoRefresh ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400')
            }, autoRefresh ? '🟢 Auto-refresh (4s)' : '⚪ Auto-refresh Off'),
            h('button', {
              onClick: () => fetchLogs(token),
              disabled: loading,
              class: 'px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white transition'
            }, loading ? 'Refreshing...' : '🔄 Refresh Now'),
            h('button', {
              onClick: () => { localStorage.removeItem('hendy_admin_token'); setToken(''); },
              class: 'px-3 py-1.5 rounded-lg text-xs text-rose-400 hover:text-rose-300 transition'
            }, 'Sign Out')
          )
        ),

        error && h('div', { class: 'p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between' },
          h('span', null, '⚠️ ' + error),
          h('button', { onClick: () => setError(null), class: 'text-xs underline' }, 'Dismiss')
        ),

        // KPI Stat Cards
        h('div', { class: 'grid grid-cols-2 lg:grid-cols-5 gap-4' },
          h('div', { class: 'glass-card p-5 rounded-2xl' },
            h('span', { class: 'text-xs font-medium text-slate-400' }, 'Total Webhook Updates'),
            h('div', { class: 'text-2xl font-bold mt-1 text-white' }, analytics.totalIncoming)
          ),
          h('div', { class: 'glass-card p-5 rounded-2xl' },
            h('span', { class: 'text-xs font-medium text-slate-400' }, 'Button Callbacks'),
            h('div', { class: 'text-2xl font-bold mt-1 text-emerald-400' }, analytics.totalCallbacks)
          ),
          h('div', { class: 'glass-card p-5 rounded-2xl' },
            h('span', { class: 'text-xs font-medium text-slate-400' }, 'Processed Success'),
            h('div', { class: 'text-2xl font-bold mt-1 text-blue-400' }, analytics.successfulCallbacks)
          ),
          h('div', { class: 'glass-card p-5 rounded-2xl' },
            h('span', { class: 'text-xs font-medium text-slate-400' }, 'Signature Rejections'),
            h('div', { class: 'text-2xl font-bold mt-1 ' + (analytics.rejectedSignatures > 0 ? 'text-rose-400' : 'text-slate-400') }, analytics.rejectedSignatures)
          ),
          h('div', { class: 'glass-card p-5 rounded-2xl' },
            h('span', { class: 'text-xs font-medium text-slate-400' }, 'Avg Processing Time'),
            h('div', { class: 'text-2xl font-bold mt-1 text-amber-400' }, analytics.avgLatency + ' ms')
          )
        ),

        // Recharts Charts Grid
        h('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-6' },
          // Chart 1: Button Callbacks Breakdown
          h('div', { class: 'glass-card p-6 rounded-2xl' },
            h('h3', { class: 'text-sm font-semibold text-slate-200 mb-4' }, '🎯 Button Trigger Frequency (Top Actions)'),
            analytics.buttonChartData.length > 0 && window.Recharts
              ? h(ResponsiveContainer, { width: '100%', height: 260 },
                  h(BarChart, { data: analytics.buttonChartData, margin: { top: 10, right: 10, left: -20, bottom: 20 } },
                    h(CartesianGrid, { strokeDasharray: '3 3', stroke: '#1e293b' }),
                    h(XAxis, { dataKey: 'action', stroke: '#64748b', fontSize: 11, angle: -20, textAnchor: 'end' }),
                    h(YAxis, { stroke: '#64748b', fontSize: 11 }),
                    h(Tooltip, { contentStyle: { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' } }),
                    h(Bar, { dataKey: 'success', name: 'Success Triggers', fill: '#22c55e', radius: [4, 4, 0, 0] }),
                    h(Bar, { dataKey: 'failure', name: 'Failed Triggers', fill: '#ef4444', radius: [4, 4, 0, 0] })
                  )
                )
              : h('div', { class: 'h-64 flex items-center justify-center text-sm text-slate-500' }, 'No button callback records yet. Click buttons on Telegram to populate.')
          ),

          // Chart 2: Outcome & Failure Breakdown
          h('div', { class: 'glass-card p-6 rounded-2xl' },
            h('h3', { class: 'text-sm font-semibold text-slate-200 mb-4' }, '🛡️ Webhook Integrity & Failure Breakdown'),
            analytics.outcomeChartData.length > 0 && window.Recharts
              ? h(ResponsiveContainer, { width: '100%', height: 260 },
                  h(PieChart, null,
                    h(Pie, {
                      data: analytics.outcomeChartData,
                      dataKey: 'value',
                      nameKey: 'name',
                      cx: '50%',
                      cy: '50%',
                      outerRadius: 85,
                      innerRadius: 45,
                      paddingAngle: 4
                    }, analytics.outcomeChartData.map((entry, index) =>
                      h(Cell, { key: 'cell-' + index, fill: entry.color || PIE_COLORS[index % PIE_COLORS.length] })
                    )),
                    h(Tooltip, { contentStyle: { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' } }),
                    h(Legend, { verticalAlign: 'bottom', height: 36, wrapperStyle: { fontSize: '12px' } })
                  )
                )
              : h('div', { class: 'h-64 flex items-center justify-center text-sm text-slate-500' }, 'No failure records captured.')
          ),

          // Chart 3: Latency Timeline
          h('div', { class: 'glass-card p-6 rounded-2xl lg:col-span-2' },
            h('h3', { class: 'text-sm font-semibold text-slate-200 mb-4' }, '⚡ Webhook Latency Trend (Recent Updates)'),
            analytics.timeline.length > 0 && window.Recharts
              ? h(ResponsiveContainer, { width: '100%', height: 220 },
                  h(AreaChart, { data: analytics.timeline, margin: { top: 10, right: 10, left: -20, bottom: 0 } },
                    h(CartesianGrid, { strokeDasharray: '3 3', stroke: '#1e293b' }),
                    h(XAxis, { dataKey: 'time', stroke: '#64748b', fontSize: 11 }),
                    h(YAxis, { stroke: '#64748b', fontSize: 11, unit: 'ms' }),
                    h(Tooltip, { contentStyle: { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' } }),
                    h(Area, { type: 'monotone', dataKey: 'durationMs', name: 'Processing (ms)', stroke: '#38bdf8', fill: '#0284c7', fillOpacity: 0.25 })
                  )
                )
              : h('div', { class: 'h-48 flex items-center justify-center text-sm text-slate-500' }, 'No latency timeline metrics available.')
          )
        ),

        // Live Trace Inspector Table
        h('div', { class: 'glass-card p-6 rounded-2xl space-y-4' },
          h('div', { class: 'flex flex-col sm:flex-row sm:items-center justify-between gap-3' },
            h('div', null,
              h('h3', { class: 'text-base font-semibold text-white' }, '🔍 Incoming Payload Inspector'),
              h('p', { class: 'text-xs text-slate-400' }, 'Live audit of Telegram updates received by the webhook handler')
            ),
            h('div', { class: 'flex items-center gap-2' },
              h('span', { class: 'text-xs text-slate-400' }, 'Filter:'),
              h('select', {
                value: selectedFilter,
                onChange: (e) => setSelectedFilter(e.target.value),
                class: 'px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none'
              },
                h('option', { value: 'all' }, 'All Updates (' + traces.length + ')'),
                h('option', { value: 'callback_query' }, 'Button Callbacks Only'),
                h('option', { value: 'errors' }, 'Errors & Rejections'),
                h('option', { value: 'rejected_sig' }, 'Signature Mismatches')
              )
            )
          ),

          h('div', { class: 'overflow-x-auto custom-scrollbar' },
            h('table', { class: 'w-full text-left text-xs border-collapse' },
              h('thead', { class: 'text-slate-400 border-b border-slate-800 bg-slate-900/60' },
                h('tr', null,
                  h('th', { class: 'py-2.5 px-3' }, 'Timestamp'),
                  h('th', { class: 'py-2.5 px-3' }, 'Event'),
                  h('th', { class: 'py-2.5 px-3' }, 'Update ID'),
                  h('th', { class: 'py-2.5 px-3' }, 'Type / Action'),
                  h('th', { class: 'py-2.5 px-3' }, 'Sender'),
                  h('th', { class: 'py-2.5 px-3' }, 'Details / Error'),
                  h('th', { class: 'py-2.5 px-3 text-right' }, 'Action')
                )
              ),
              h('tbody', { class: 'divide-y divide-slate-800/60' },
                filteredTraces.length === 0
                  ? h('tr', null, h('td', { colSpan: 7, class: 'py-8 text-center text-slate-500' }, 'No matching traces in memory buffer.'))
                  : filteredTraces.map((t, idx) => {
                      const isError = t.event === 'error' || t.event === 'rejected';
                      const badgeClass = t.event === 'processed'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : isError
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

                      return h('tr', { key: idx, class: 'hover:bg-slate-800/40 transition' },
                        h('td', { class: 'py-2.5 px-3 font-mono text-slate-400' }, new Date(t.timestamp).toLocaleTimeString()),
                        h('td', { class: 'py-2.5 px-3' },
                          h('span', { class: 'px-2 py-0.5 rounded-full text-[10px] font-semibold border ' + badgeClass }, t.event)
                        ),
                        h('td', { class: 'py-2.5 px-3 font-mono text-slate-300' }, t.updateId || t.summary?.updateId || '—'),
                        h('td', { class: 'py-2.5 px-3' },
                          t.summary?.type === 'callback_query'
                            ? h('span', { class: 'font-semibold text-emerald-300' }, '🔘 ' + t.summary.data)
                            : t.summary?.isCommand
                            ? h('span', { class: 'font-semibold text-indigo-300' }, '⚡ /' + t.summary.command)
                            : (t.summary?.type || t.reason || 'update')
                        ),
                        h('td', { class: 'py-2.5 px-3 text-slate-300' },
                          t.summary?.from?.id ? (t.summary.from.name + ' (' + t.summary.from.id + ')') : '—'
                        ),
                        h('td', { class: 'py-2.5 px-3 text-slate-400 truncate max-w-xs' },
                          t.error ? ('❌ ' + t.error) : t.reason ? ('⛔ ' + t.reason) : (t.durationMs !== undefined ? (t.durationMs + ' ms') : (t.summary?.text || 'OK'))
                        ),
                        h('td', { class: 'py-2.5 px-3 text-right' },
                          h('button', {
                            onClick: () => setExpandedTrace(expandedTrace === t ? null : t),
                            class: 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]'
                          }, expandedTrace === t ? 'Hide' : 'Inspect')
                        )
                      );
                    })
              )
            )
          ),

          expandedTrace && h('div', { class: 'p-4 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-2' },
            h('div', { class: 'flex items-center justify-between' },
              h('span', { class: 'text-xs font-bold text-slate-200' }, 'Payload Inspector — Raw Trace Details'),
              h('button', { onClick: () => setExpandedTrace(null), class: 'text-xs text-slate-400 hover:text-white' }, '✕ Close')
            ),
            h('pre', { class: 'text-xs font-mono text-emerald-300 bg-black/60 p-3 rounded-lg overflow-x-auto max-h-60 custom-scrollbar' },
              JSON.stringify(expandedTrace, null, 2)
            )
          )
        )
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  </script>
</body>
</html>`;
}
