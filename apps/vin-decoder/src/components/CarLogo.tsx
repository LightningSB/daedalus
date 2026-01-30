import React from 'react';
import { getCarLogo } from '../lib/carLogos';

interface CarLogoProps {
  make: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CarLogo: React.FC<CarLogoProps> = ({ make, size = 'md' }) => {
  const logoUrl = getCarLogo(make);
  
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  return (
    <div className={`
      ${sizeClasses[size]}
      rounded-lg bg-white/10 backdrop-blur-sm
      flex items-center justify-center
      border border-white/10
      overflow-hidden
    `}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={make}
          className="w-full h-full object-contain p-1"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<span class="text-white/60 font-bold text-xs">${make?.charAt(0) || '?'}</span>`;
            }
          }}
        />
      ) : (
        <div className="flex flex-col items-center justify-center">
          <svg className={`${iconSizes[size]} text-white/40`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          {make && (
            <span className="text-white/60 font-bold text-[10px] mt-0.5">
              {make.charAt(0)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
