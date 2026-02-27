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

const LAYERS = {
  top: [
    { id: 'ctrl', label: '⌃', ariaLabel: 'Ctrl', layer: 'ctrl', action: { action: 'ctrl' } },
    { id: 'alt', label: '⎇', ariaLabel: 'Alt', layer: 'alt', action: { action: 'alt' } },
    { id: 'esc', label: '⎋', ariaLabel: 'Esc', action: { sequence: '\u001b' } },
    { id: 'tab', label: '⇥', ariaLabel: 'Tab', action: { sequence: '\t' } },
    { id: 'kb', label: '⌨', ariaLabel: 'Toggle Keyboard', action: { action: 'hideKeyboard' } },
    { id: 'ts', label: '◉', ariaLabel: 'Toggle Thumbstick', localAction: 'toggleThumbstick' },
    { id: 'zoom', label: '🔍', ariaLabel: 'Zoom Controls', layer: 'zoom' },
  ],
  ctrl: [
    { id: 'back', label: '↩', ariaLabel: 'Back', layer: 'top' },
    { id: 'ctrl-c', label: '⌃C', ariaLabel: 'Ctrl+C', sequence: '\u0003' },
    { id: 'ctrl-d', label: '⌃D', ariaLabel: 'Ctrl+D', sequence: '\u0004' },
    { id: 'ctrl-l', label: '⌃L', ariaLabel: 'Ctrl+L', sequence: '\u000c' },
    { id: 'ctrl-u', label: '⌃U', ariaLabel: 'Ctrl+U', sequence: '\u0015' },
    { id: 'ctrl-z', label: '⌃Z', ariaLabel: 'Ctrl+Z', sequence: '\u001a' },
    { id: 'paste', label: '📋', ariaLabel: 'Paste', action: { action: 'paste' } },
  ],
  alt: [
    { id: 'back', label: '↩', ariaLabel: 'Back', layer: 'top' },
    { id: 'alt-b', label: '⎇B', ariaLabel: 'Alt+B', sequence: '\u001bb' },
    { id: 'alt-f', label: '⎇F', ariaLabel: 'Alt+F', sequence: '\u001bf' },
    { id: 'pgup', label: '⇞', ariaLabel: 'Page Up', sequence: '\u001b[5~' },
    { id: 'pgdn', label: '⇟', ariaLabel: 'Page Down', sequence: '\u001b[6~' },
    { id: 'home', label: '↖', ariaLabel: 'Home', sequence: '\u001b[H' },
    { id: 'end', label: '↘', ariaLabel: 'End', sequence: '\u001b[F' },
  ],
  zoom: [
    { id: 'back', label: '↩', ariaLabel: 'Back', layer: 'top' },
    { id: 'zoom-in', label: '⊕', ariaLabel: 'Zoom In', action: { action: 'fontUp' } },
    { id: 'zoom-out', label: '⊖', ariaLabel: 'Zoom Out', action: { action: 'fontDown' } },
    { id: 'zoom-reset', label: '⊜', ariaLabel: 'Zoom Reset', action: { action: 'fontReset' } },
  ]
};

const ARROW_ACTIONS = {
  up: { label: '↑', sequence: '\u001b[A' },
  down: { label: '↓', sequence: '\u001b[B' },
  left: { label: '←', sequence: '\u001b[D' },
  right: { label: '→', sequence: '\u001b[C' },
};

const calculateNodes = (items: any[], layerName: string) => {
  return items.map((item, i) => {
    const isTop = layerName === 'top';
    const spacingX = 58; // Horizontal spacing between nodes
    const spacingY = 58; // Vertical spacing for nested layers
    
    // Top-level controls expand horizontally to the LEFT.
    // Second-level controls appear ABOVE that top-level row, also to the LEFT.
    const x = -spacingX * (i + 1);
    const y = isTop ? 0 : -spacingY;
    
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
      const calculated = calculateNodes(items, layerName);
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

    if (!node.layer) {
      // Top-level nodes without a layer (Esc, Tab, KB, Thumb) fire immediately
      fireAction(node);
      return;
    }

    // Top-level nodes WITH a layer (Ctrl, Alt, Zoom)
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
        // On timeout (single click confirmed), open nested layer
        setActiveLayer(node.layer);
      }, 250);
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
                aria-label={node.item.ariaLabel || node.item.label}
                className={`radial-node ${isActiveLayer ? 'visible' : ''} ${node.item.action?.action === 'ctrl' && ctrlArmed ? 'armed' : ''}`}
                style={{
                  transform: isActiveLayer 
                    ? `translate(${node.x}px, ${node.y}px) scale(${isPending ? 0.9 : 1})` 
                    : `translate(0px, 0px) scale(0.3)`,
                  opacity: isActiveLayer ? 1 : 0,
                  visibility: isActiveLayer ? 'visible' : 'hidden',
                  transitionDelay: isActiveLayer ? `${node.ringIndex * 0.02}s` : '0s'
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleNodeClick(node.item);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
                  {node.item.label && (
                    <span style={{ 
                      fontSize: node.item.label.length <= 2 ? '22px' : '14px', 
                      opacity: 0.9, 
                      lineHeight: 1 
                    }}>
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
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMenu();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            aria-label="Toggle keyboard shortcuts"
          >
            +
          </button>
        </div>
      </div>
    </>
  );
};
