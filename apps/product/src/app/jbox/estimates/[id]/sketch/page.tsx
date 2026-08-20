'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

interface CanvasSymbol {
  symbol_id: string;
  category: string;
  display_name: string;
  icon_svg_path: string;
  price_book_item_id?: string;
  price_book_name?: string;
  unit_price_cents?: number;
}

interface PlacedElement {
  id: string;
  symbol_id: string;
  display_name: string;
  x: number;
  y: number;
  unit_price_cents: number;
}

const GRID_SIZE = 16;
const SYMBOL_SIZE = 32;

const THEME = {
  bg: '#0f172a',
  panel: '#1e293b',
  border: '#334155',
  accent: '#f59e0b',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  danger: '#ef4444',
};

export default function SketchPage() {
  const params = useParams();
  const estimateId = params.id as string;

  const canvasRef = useRef<HTMLDivElement>(null);

  const [symbols, setSymbols] = useState<CanvasSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState<CanvasSymbol | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [placedElements, setPlacedElements] = useState<PlacedElement[]>([]);
  const [hoveredElement, setHoveredElement] = useState<PlacedElement | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    fetch('/api/field/sketch/symbols')
      .then((res) => res.json())
      .then((data: { palette?: CanvasSymbol[] }) => {
        const items = data.palette ?? [];
        setSymbols(items);
        if (items.length > 0) {
          const cats = Array.from(new Set(items.map((s) => s.category)));
          setActiveCategory(cats[0] ?? 'All');
        }
      })
      .catch(() => setSymbols([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(symbols.map((s) => s.category)));
    return ['All', ...cats];
  }, [symbols]);

  const filteredSymbols = useMemo(() => {
    if (activeCategory === 'All') return symbols;
    return symbols.filter((s) => s.category === activeCategory);
  }, [symbols, activeCategory]);

  const totalCents = useMemo(
    () => placedElements.reduce((sum, el) => sum + el.unit_price_cents, 0),
    [placedElements]
  );

  const formatCurrency = (cents: number) =>
    `$${(cents / 100).toFixed(2)}`;

  const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!selectedSymbol || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const rawX = e.clientX - rect.left - SYMBOL_SIZE / 2;
      const rawY = e.clientY - rect.top - SYMBOL_SIZE / 2;
      const x = snapToGrid(rawX);
      const y = snapToGrid(rawY);

      const newElement: PlacedElement = {
        id: `${selectedSymbol.symbol_id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol_id: selectedSymbol.symbol_id,
        display_name: selectedSymbol.display_name,
        x,
        y,
        unit_price_cents: selectedSymbol.unit_price_cents ?? 0,
      };

      setPlacedElements((prev) => [...prev, newElement]);
    },
    [selectedSymbol]
  );

  const handleElementHover = useCallback((el: PlacedElement, e: React.MouseEvent) => {
    setHoveredElement(el);
    setTooltipPos({ x: e.clientX + 12, y: e.clientY - 8 });
  }, []);

  const handleElementLeave = useCallback(() => {
    setHoveredElement(null);
  }, []);

  const clearAll = useCallback(() => {
    if (confirm('Clear all placed elements?')) {
      setPlacedElements([]);
    }
  }, []);

  const handleSaveAndSync = useCallback(async () => {
    if (placedElements.length === 0) return;
    try {
      const res = await fetch('/api/field/sketch/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimateId, elements: placedElements }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error ?? 'Failed to save takeoff.');
        return;
      }
      alert(`Saved! ${data.elementCount} elements synced to bid. Total: $${(data.totalCents / 100).toFixed(2)}`);
    } catch {
      alert('Could not save takeoff. Please try again.');
    }
  }, [estimateId, placedElements]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: THEME.bg,
          color: THEME.textSecondary,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 16,
        }}
      >
        <span style={{ marginRight: 12 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="10" cy="10" r="8" stroke={THEME.border} strokeWidth="2" />
            <path d="M10 2a8 8 0 0 1 8 8" stroke={THEME.accent} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        Loading Trade Symbols &amp; Takeoff Canvas...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: THEME.bg,
        color: THEME.textPrimary,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: `1px solid ${THEME.border}`,
          backgroundColor: THEME.panel,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            backgroundColor: THEME.accent,
            color: '#000',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Takeoff Sketcher
        </span>

        <span
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            backgroundColor: THEME.border,
            color: THEME.textSecondary,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {activeCategory === 'All' ? 'All Categories' : activeCategory}
        </span>

        <span style={{ color: THEME.textMuted, fontSize: 13 }}>
          Bid #{estimateId}
        </span>

        <div style={{ flex: 1 }} />

        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: THEME.accent,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatCurrency(totalCents)}
        </span>

        <button
          onClick={handleSaveAndSync}
          style={{
            padding: '6px 16px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: THEME.accent,
            color: '#000',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            letterSpacing: 0.3,
          }}
        >
          Save &amp; Sync to Bid
        </button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left Sidebar — Symbol Palette */}
        <div
          style={{
            width: 240,
            borderRight: `1px solid ${THEME.border}`,
            backgroundColor: THEME.panel,
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {/* Category Tabs */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '10px 10px 8px',
              borderBottom: `1px solid ${THEME.border}`,
            }}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  setActiveCategory(cat);
                  setSelectedSymbol(null);
                }}
                style={{
                  padding: '3px 8px',
                  borderRadius: 3,
                  border: `1px solid ${activeCategory === cat ? THEME.accent : THEME.border}`,
                  backgroundColor: activeCategory === cat ? THEME.accent : 'transparent',
                  color: activeCategory === cat ? '#000' : THEME.textSecondary,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Symbol List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {filteredSymbols.length === 0 && (
              <div style={{ color: THEME.textMuted, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                No symbols in this category.
              </div>
            )}
            {filteredSymbols.map((sym) => {
              const isSelected = selectedSymbol?.symbol_id === sym.symbol_id;
              return (
                <button
                  key={sym.symbol_id}
                  onClick={() => setSelectedSymbol(isSelected ? null : sym)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    marginBottom: 4,
                    borderRadius: 4,
                    border: `1px solid ${isSelected ? THEME.accent : THEME.border}`,
                    backgroundColor: isSelected ? 'rgba(245,158,11,0.1)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      backgroundColor: isSelected ? THEME.accent : THEME.border,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={isSelected ? '#000' : THEME.textSecondary}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={sym.icon_svg_path} />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: THEME.textPrimary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {sym.display_name}
                    </div>
                    <div style={{ fontSize: 11, color: THEME.textMuted }}>
                      {sym.unit_price_cents != null ? formatCurrency(sym.unit_price_cents) : '—'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Area — Canvas */}
        <div
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            cursor: selectedSymbol ? 'crosshair' : 'default',
            backgroundImage: `radial-gradient(circle, ${THEME.border} 1px, transparent 1px)`,
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        >
          {/* Empty state hint */}
          {placedElements.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                color: THEME.textMuted,
                fontSize: 14,
              }}
            >
              {selectedSymbol
                ? 'Click anywhere on the grid to place a symbol'
                : 'Select a symbol from the palette to begin'}
            </div>
          )}

          {/* Placed Elements */}
          {placedElements.map((el) => (
            <div
              key={el.id}
              onMouseEnter={(e) => handleElementHover(el, e)}
              onMouseMove={(e) => handleElementHover(el, e)}
              onMouseLeave={handleElementLeave}
              style={{
                position: 'absolute',
                left: el.x,
                top: el.y,
                width: SYMBOL_SIZE,
                height: SYMBOL_SIZE,
                borderRadius: '50%',
                backgroundColor: THEME.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                pointerEvents: 'auto',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
          ))}

          {/* Hover Tooltip */}
          {hoveredElement && (
            <div
              style={{
                position: 'fixed',
                left: tooltipPos.x,
                top: tooltipPos.y,
                padding: '6px 10px',
                borderRadius: 4,
                backgroundColor: THEME.panel,
                border: `1px solid ${THEME.border}`,
                color: THEME.textPrimary,
                fontSize: 12,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 50,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{hoveredElement.display_name}</div>
              <div style={{ color: THEME.accent }}>
                {formatCurrency(hoveredElement.unit_price_cents)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderTop: `1px solid ${THEME.border}`,
          backgroundColor: THEME.panel,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, color: THEME.textSecondary }}>
          {placedElements.length} element{placedElements.length !== 1 ? 's' : ''} placed
        </span>

        <button
          onClick={clearAll}
          disabled={placedElements.length === 0}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: `1px solid ${THEME.danger}`,
            backgroundColor: 'transparent',
            color: THEME.danger,
            fontSize: 12,
            fontWeight: 600,
            cursor: placedElements.length === 0 ? 'not-allowed' : 'pointer',
            opacity: placedElements.length === 0 ? 0.4 : 1,
          }}
        >
          Clear Drawing
        </button>
      </div>
    </div>
  );
}
