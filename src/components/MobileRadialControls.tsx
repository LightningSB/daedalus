import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';

export type MobileControl = {
  label: string;
  sequence?: string;
  action?: 'ctrl' | 'paste' | 'hideKeyboard' | 'fontUp' | 'fontDown' | 'fontReset';
};

interface MobileRadialControlsProps {
  onControlPress: (control: MobileControl) => void;
  ctrlArmed: boolean;
}

const RADIAL_ACTIONS: MobileControl[] = [
  { label: 'Esc', sequence: '\u001b' },
  { label: 'Tab', sequence: '\t' },
  { label: 'Ctrl', action: 'ctrl' },
  { label: 'PgUp', sequence: '\u001b[5~' },
  { label: 'PgDn', sequence: '\u001b[6~' },
  { label: 'Home', sequence: '\u001b[H' },
  { label: 'End', sequence: '\u001b[F' },
  { label: 'Ctrl+C', sequence: '\u0003' },
  { label: 'Ctrl+D', sequence: '\u0004' },
  { label: 'Ctrl+L', sequence: '\u000c' },
  { label: 'Ctrl+U', sequence: '\u0015' },
  { label: 'Ctrl+Z', sequence: '\u001a' },
  { label: 'A-', action: 'fontDown' },
  { label: 'A+', action: 'fontUp' },
  { label: 'A=', action: 'fontReset' },
  { label: 'Paste', action: 'paste' },
  { label: 'Hide KB', action: 'hideKeyboard' },
];

const ARROW_ACTIONS = {
  up: { label: '↑', sequence: '\u001b[A' },
  down: { label: '↓', sequence: '\u001b[B' },
  left: { label: '←', sequence: '\u001b[D' },
  right: { label: '→', sequence: '\u001b[C' },
};

export const MobileRadialControls: React.FC<MobileRadialControlsProps> = ({
  onControlPress,
  ctrlArmed,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Thumbstick state
  const [thumbPosition, setThumbPosition] = useState({ x: 0, y: 0 });
  const thumbstickRef = useRef<HTMLDivElement>(null);
  const activeArrowsRef = useRef<Set<string>>(new Set());
  const arrowIntervalRef = useRef<number | null>(null);

  const toggleMenu = () => setIsOpen(!isOpen);

  // Radial positions
  const nodes = useMemo(() => {
    // We want nodes to expand from bottom-right towards top-left.
    // Angles in degrees: 180 (left), 270 (up).
    // Let's use 2 rings.
    
    return RADIAL_ACTIONS.map((action, i) => {
      const ring = i < 8 ? 0 : 1;
      const ringIndex = i < 8 ? i : i - 8;
      const ringNodesCount = i < 8 ? 8 : RADIAL_ACTIONS.length - 8;
      
      const ringRadius = 85 + ring * 55;
      const angleStep = 90 / (ringNodesCount - 1);
      const angle = 180 + (ringIndex * angleStep);
      
      const rad = (angle * Math.PI) / 180;
      const x = Math.cos(rad) * ringRadius;
      const y = Math.sin(rad) * ringRadius;
      
      return { action, x, y };
    });
  }, []);

  // Thumbstick logic
  const handleTouchStart = (e: React.TouchEvent) => {
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!thumbstickRef.current) return;
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
    
    // Determine arrows
    const threshold = 12;
    const newArrows = new Set<string>();
    if (dy < -threshold) newArrows.add('up');
    if (dy > threshold) newArrows.add('down');
    if (dx < -threshold) newArrows.add('left');
    if (dx > threshold) newArrows.add('right');
    
    // Compare sets
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

      {/* Radial Menu */}
      <div className="mobile-controls-floating">
        <div className="radial-container">
          {nodes.map((node, i) => (
            <button
              key={node.action.label}
              type="button"
              className={`radial-node ${isOpen ? 'visible' : ''} ${node.action.action === 'ctrl' && ctrlArmed ? 'armed' : ''}`}
              style={{
                transform: isOpen 
                  ? `translate(${node.x}px, ${node.y}px)` 
                  : `translate(0, 0)`,
                transitionDelay: isOpen ? `${i * 0.02}s` : '0s'
              }}
              onClick={() => {
                onControlPress(node.action);
                if (node.action.action !== 'ctrl') setIsOpen(false);
              }}
            >
              {node.action.label}
            </button>
          ))}
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
