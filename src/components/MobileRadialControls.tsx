import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

export type MobileControl = {
  label: string;
  sequence?: string;
  action?: 'ctrl' | 'paste' | 'hideKeyboard' | 'fontUp' | 'fontDown' | 'fontReset' | string;
};

interface MobileRadialControlsProps {
  onControlPress: (control: MobileControl) => void;
  ctrlArmed: boolean;
}

// Minimal, scalable SVG Icons
const IconCtrl = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>;
const IconAlt = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h6l6 18h6"/><path d="M14 3h7"/></svg>;
const IconKB = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M6 12h.01"/><path d="M10 12h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/><path d="M7 16h10"/></svg>;
const IconTS = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" ry="2"/><circle cx="8" cy="12" r="2"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/></svg>;
const IconZoom = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>;
const IconBack = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
const IconTab = () => <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12H3"/><path d="M15 6l6 6-6 6"/><path d="M3 6v12"/></svg>;
const IconEsc = () => <span style={{fontSize: '12px', fontWeight: 'bold'}}>ESC</span>;

const LAYERS = {
  top: [
    { id: 'ctrl', label: 'Ctrl', icon: <IconCtrl/>, layer: 'ctrl', action: { action: 'ctrl' } },
    { id: 'alt', label: 'Alt', icon: <IconAlt/>, layer: 'alt', action: { action: 'alt' } },
    { id: 'esc', label: 'Esc', icon: <IconEsc/>, action: { sequence: '\u001b' } },
    { id: 'tab', label: 'Tab', icon: <IconTab/>, action: { sequence: '\t' } },
    { id: 'kb', label: 'KB', icon: <IconKB/>, action: { action: 'hideKeyboard' } },
    { id: 'ts', label: 'Thumb', icon: <IconTS/>, localAction: 'toggleThumbstick' },
    { id: 'zoom', label: 'Zoom', icon: <IconZoom/>, layer: 'zoom' },
  ],
  ctrl: [
    { id: 'back', label: 'Back', icon: <IconBack/>, layer: 'top' },
    { id: 'ctrl-c', label: 'Ctrl+C', sequence: '\u0003' },
    { id: 'ctrl-d', label: 'Ctrl+D', sequence: '\u0004' },
    { id: 'ctrl-l', label: 'Ctrl+L', sequence: '\u000c' },
    { id: 'ctrl-u', label: 'Ctrl+U', sequence: '\u0015' },
    { id: 'ctrl-z', label: 'Ctrl+Z', sequence: '\u001a' },
    { id: 'paste', label: 'Paste', action: { action: 'paste' } },
  ],
  alt: [
    { id: 'back', label: 'Back', icon: <IconBack/>, layer: 'top' },
    { id: 'alt-b', label: 'Alt+B', sequence: '\u001bb' },
    { id: 'alt-f', label: 'Alt+F', sequence: '\u001bf' },
    { id: 'pgup', label: 'PgUp', sequence: '\u001b[5~' },
    { id: 'pgdn', label: 'PgDn', sequence: '\u001b[6~' },
    { id: 'home', label: 'Home', sequence: '\u001b[H' },
    { id: 'end', label: 'End', sequence: '\u001b[F' },
  ],
  zoom: [
    { id: 'back', label: 'Back', icon: <IconBack/>, layer: 'top' },
    { id: 'zoom-in', label: 'A+', action: { action: 'fontUp' } },
    { id: 'zoom-out', label: 'A-', action: { action: 'fontDown' } },
    { id: 'zoom-reset', label: 'A=', action: { action: 'fontReset' } },
  ]
};

const ARROW_ACTIONS = {
  up: { label: '↑', sequence: '\u001b[A' },
  down: { label: '↓', sequence: '\u001b[B' },
  left: { label: '←', sequence: '\u001b[D' },
  right: { label: '→', sequence: '\u001b[C' },
};

const calculateNodes = (items: any[]) => {
  const maxPerRing = 5;
  return items.map((item, i) => {
    const ring = Math.floor(i / maxPerRing);
    const ringIndex = i % maxPerRing;
    const ringNodesCount = Math.min(items.length - ring * maxPerRing, maxPerRing);
    
    const ringRadius = 85 + ring * 55;
    const angleStep = ringNodesCount > 1 ? 90 / (ringNodesCount - 1) : 0;
    const angle = 180 + (ringIndex * angleStep);
    
    const rad = (angle * Math.PI) / 180;
    const x = Math.cos(rad) * ringRadius;
    const y = Math.sin(rad) * ringRadius;
    
    return { item, x, y, ringIndex: i };
  });
};

export const MobileRadialControls: React.FC<MobileRadialControlsProps> = ({
  onControlPress,
  ctrlArmed,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeLayer, setActiveLayer] = useState<keyof typeof LAYERS>('top');
  const [isThumbstickVisible, setIsThumbstickVisible] = useState(false);
  const [pendingClickId, setPendingClickId] = useState<string | null>(null);
  
  const clickTimeoutRef = useRef<number | null>(null);

  // Thumbstick state
  const [thumbPosition, setThumbPosition] = useState({ x: 0, y: 0 });
  const thumbstickRef = useRef<HTMLDivElement>(null);
  const activeArrowsRef = useRef<Set<string>>(new Set());
  const arrowIntervalRef = useRef<number | null>(null);

  const toggleMenu = () => {
    setIsOpen(v => {
      if (v) {
        setTimeout(() => setActiveLayer('top'), 400); // Reset layer after collapse animation
      }
      return !v;
    });
  };

  const allNodes = useMemo(() => {
    const nodes: any[] = [];
    Object.entries(LAYERS).forEach(([layerName, items]) => {
      const calculated = calculateNodes(items);
      calculated.forEach(calc => nodes.push({ ...calc, layerName }));
    });
    return nodes;
  }, []);

  const fireAction = useCallback((node: any) => {
    if (node.action && onControlPress) {
      onControlPress(node.action as MobileControl);
    }
    if (node.localAction === 'toggleThumbstick') {
      setIsThumbstickVisible(v => !v);
    }
    if (node.layer && !Object.values(LAYERS.top).some(n => n.id === node.id)) {
      setActiveLayer(node.layer);
    }
    
    // Close menu on action, unless it's an arming modifier or nested nav
    if (!node.layer && node.id !== 'ts' && node.action?.action !== 'ctrl') {
      setIsOpen(false);
      setTimeout(() => setActiveLayer('top'), 400);
    }
  }, [onControlPress]);

  const handleNodeClick = useCallback((node: any) => {
    const isTopLevel = Object.values(LAYERS.top).some(n => n.id === node.id);

    // Immediate action for nested layers
    if (!isTopLevel) {
      fireAction(node);
      return;
    }

    if (pendingClickId === node.id) {
      // It's a double click!
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      setPendingClickId(null);
      fireAction(node);
    } else {
      // First click
      setPendingClickId(node.id);
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      
      clickTimeoutRef.current = window.setTimeout(() => {
        setPendingClickId(null);
        // On timeout (single click confirmed), open nested layer if it exists
        if (node.layer) {
          setActiveLayer(node.layer);
        }
      }, 300);
    }
  }, [pendingClickId, fireAction]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
    };
  }, []);

  // Thumbstick logic
  const handleTouchStart = (e: React.TouchEvent) => handleTouchMove(e);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!thumbstickRef.current || !isThumbstickVisible) return;
    const touch = e.touches[0];
    const rect = thumbstickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxRadius = rect.width / 2 - 10;
    
    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }
    
    setThumbPosition({ x: dx, y: dy });
    
    const threshold = 12;
    const newArrows = new Set<string>();
    if (dy < -threshold) newArrows.add('up');
    if (dy > threshold) newArrows.add('down');
    if (dx < -threshold) newArrows.add('left');
    if (dx > threshold) newArrows.add('right');
    
    const currentArrows = activeArrowsRef.current;
    const changed = newArrows.size !== currentArrows.size || ![...newArrows].every(a => currentArrows.has(a));
    
    if (changed) {
      activeArrowsRef.current = newArrows;
      if (newArrows.size > 0) {
        if (arrowIntervalRef.current) clearInterval(arrowIntervalRef.current);
        startArrowInterval();
      } else {
        stopArrowInterval();
      }
    }
  };

  const handleTouchEnd = () => {
    setThumbPosition({ x: 0, y: 0 });
    activeArrowsRef.current.clear();
    stopArrowInterval();
  };

  const startArrowInterval = useCallback(() => {
    const tick = () => {
      activeArrowsRef.current.forEach(dir => {
        onControlPress(ARROW_ACTIONS[dir as keyof typeof ARROW_ACTIONS]);
      });
    };
    tick();
    arrowIntervalRef.current = window.setInterval(tick, 120);
  }, [onControlPress]);

  const stopArrowInterval = useCallback(() => {
    if (arrowIntervalRef.current) {
      clearInterval(arrowIntervalRef.current);
      arrowIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopArrowInterval();
  }, [stopArrowInterval]);

  return (
    <>
      {/* Thumbstick */}
      {isThumbstickVisible && (
        <div className="thumbstick-wrapper">
          <div className="thumbstick-base" ref={thumbstickRef}>
            <div className="thumbstick-arrow up">↑</div>
            <div className="thumbstick-arrow down">↓</div>
            <div className="thumbstick-arrow left">←</div>
            <div className="thumbstick-arrow right">→</div>
            <div 
              className="thumbstick-handle"
              style={{ transform: `translate(${thumbPosition.x}px, ${thumbPosition.y}px)` }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
          </div>
        </div>
      )}

      {/* Radial Menu */}
      <div className="mobile-controls-floating">
        <div className="radial-container">
          {allNodes.map((node) => {
            const isActiveLayer = isOpen && activeLayer === node.layerName;
            const isPending = pendingClickId === node.item.id;
            
            return (
              <button
                key={`${node.layerName}-${node.item.id}`}
                type="button"
                className={`radial-node ${isActiveLayer ? 'visible' : ''} ${node.item.action?.action === 'ctrl' && ctrlArmed ? 'armed' : ''}`}
                style={{
                  transform: isActiveLayer 
                    ? `translate(${node.x}px, ${node.y}px) scale(${isPending ? 0.9 : 1})` 
                    : `translate(0px, 0px) scale(0.3)`,
                  opacity: isActiveLayer ? 1 : 0,
                  visibility: isActiveLayer ? 'visible' : 'hidden',
                  transitionDelay: isActiveLayer ? `${node.ringIndex * 0.02}s` : '0s'
                }}
                onClick={(e) => {
                  e.preventDefault();
                  handleNodeClick(node.item);
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
                  {node.item.icon}
                  {node.item.label && (
                    <span style={{ fontSize: '10px', marginTop: '2px', opacity: 0.9, lineHeight: 1 }}>
                      {node.item.label}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          
          <button 
            type="button"
            className={`radial-fab ${isOpen ? 'open' : ''}`}
            onClick={toggleMenu}
            aria-label="Toggle keyboard shortcuts"
          >
            +
          </button>
        </div>
      </div>
    </>
  );
};
