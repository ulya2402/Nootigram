import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../services/i18n';

interface OnboardingModalProps {
  onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const touchStartXRef = useRef<number | null>(null);
  const touchDeltaXRef = useRef<number>(0);

  const triggerHaptic = (style: 'light' | 'medium' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  const handleNext = () => {
    triggerHaptic('light');
    if (currentStep < 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    triggerHaptic('light');
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    triggerHaptic('light');
    onComplete();
  };

  const handleFinish = () => {
    triggerHaptic('medium');
    onComplete();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchDeltaXRef.current = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartXRef.current !== null) {
      touchDeltaXRef.current = e.touches[0].clientX - touchStartXRef.current;
    }
  };

  const onTouchEnd = () => {
    const delta = touchDeltaXRef.current;
    if (delta < -45 && currentStep < 1) {
      handleNext();
    } else if (delta > 45 && currentStep > 0) {
      handlePrev();
    }
    touchStartXRef.current = null;
    touchDeltaXRef.current = 0;
  };

  return createPortal(
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-50 flex flex-col justify-between bg-[#FAF8F5] text-warm-text max-w-[420px] mx-auto select-none overflow-hidden"
      style={{
        paddingTop: 'calc(max(var(--tg-content-top, 0px), var(--tg-safe-top, 0px), env(safe-area-inset-top, 0px)) + 12px)',
        paddingBottom: 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 20px)',
      }}
    >
      <header className="px-6 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-2 w-full">
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="h-1 flex-1 rounded-full bg-cream-divider overflow-hidden"
            >
              <div
                className={`h-full bg-warm-accent transition-all duration-300 ease-out ${
                  currentStep >= idx ? 'w-full' : 'w-0'
                }`}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between min-h-[28px]">
          {currentStep > 0 ? (
            <button
              type="button"
              onClick={handlePrev}
              className="text-xs font-semibold text-warm-muted hover:text-warm-text transition-colors py-1 px-1 active:opacity-60 flex items-center gap-0.5"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">chevron_left</span>
            </button>
          ) : (
            <div className="w-4 h-4" />
          )}
          {currentStep < 1 ? (
            <button
              type="button"
              onClick={handleSkip}
              className="text-xs font-semibold text-warm-muted hover:text-warm-text transition-colors py-1 px-2.5 rounded-full active:opacity-60"
            >
              {t('onboarding_skip')}
            </button>
          ) : (
            <div className="w-4 h-4" />
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-4 relative overflow-hidden">
        <div
          className="flex w-full transition-transform duration-300 ease-out will-change-transform"
          style={{ transform: `translate3d(-${currentStep * 100}%, 0, 0)` }}
        >
          <div className="w-full shrink-0 flex flex-col items-center text-center px-4">
            <div className="w-52 h-52 max-w-[220px] max-h-[220px] aspect-square rounded-2xl overflow-hidden border border-cream-divider bg-cream-surface mb-6 shadow-xs flex items-center justify-center">
              <img
                src="https://files.catbox.moe/1nm6t3.jpg"
                alt="Telegram Rich Text Post"
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-[10px] font-mono font-semibold tracking-widest uppercase text-warm-accent mb-2">
              {t('onboarding_slide1_tag')}
            </span>
            <h3 className="text-xl font-bold tracking-tight text-warm-text mb-2 max-w-[280px]">
              {t('onboarding_slide1_title')}
            </h3>
            <p className="text-xs leading-relaxed text-warm-muted max-w-[270px]">
              {t('onboarding_slide1_desc')}
            </p>
          </div>

          <div className="w-full shrink-0 flex flex-col items-center justify-center text-center px-6">
            <span className="text-[10px] font-mono font-semibold tracking-widest uppercase text-warm-accent mb-2.5">
              {t('onboarding_slide2_tag')}
            </span>
            <h3 className="text-2xl font-bold tracking-tight text-warm-text mb-3 leading-snug max-w-[280px]">
              {t('onboarding_slide2_title')}
            </h3>
            <p className="text-xs leading-relaxed text-warm-muted max-w-[270px]">
              {t('onboarding_slide2_desc')}
            </p>
          </div>
        </div>
      </main>

      <footer className="px-6 w-full shrink-0">
        {currentStep < 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="w-full h-12 rounded-full bg-warm-text text-[#FAF8F5] text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-xs"
          >
            <span>{t('onboarding_next')}</span>
            <span className="material-symbols-outlined text-[16px] leading-none">chevron_right</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            className="w-full h-12 rounded-full bg-warm-accent text-[#FAF8F5] text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-xs"
          >
            <span>{t('onboarding_btn_finish')}</span>
            <span className="material-symbols-outlined text-[16px] leading-none">check</span>
          </button>
        )}
      </footer>
    </div>,
    document.body
  );
};