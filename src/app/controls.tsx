import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = (el: HTMLElement) => {
    // 用 fixed 定位並限制在視窗內，避免撐出捲軸
    const r = el.getBoundingClientRect();
    const w = Math.min(220, window.innerWidth - 16);
    let left = r.right + 6;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 6);
    if (left < 8) left = 8;
    setPos({ left, top: Math.max(8, r.top - 6) });
    setOpen(true);
  };
  return (
    <span className="help" onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="help-btn" aria-label={text} onClick={(e) => (open ? setOpen(false) : show(e.currentTarget))}>?</button>
      {open && pos && <span className="help-pop" role="tooltip" style={{ left: pos.left, top: pos.top }}>{text}</span>}
    </span>
  );
}

interface SliderProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  extra?: ReactNode;
}

/** 滑桿：旁邊一句白話說明 + ? 提示 */
export function Slider({ label, help, value, min, max, step = 1, unit, disabled, format, onChange, extra }: SliderProps) {
  return (
    <div className={'ctrl' + (disabled ? ' disabled' : '')}>
      <div className="ctrl-head">
        <label>{label}</label>
        <Help text={help} />
        <span className="ctrl-val">{format ? format(value) : value}{unit ? ' ' + unit : ''}</span>
        {extra}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} style={{ '--pct': `${((value - min) / (max - min || 1)) * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { v: V; label: string }[]; onChange: (v: V) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span /></span>
      <span>{label}</span>
      {help && <Help text={help} />}
    </label>
  );
}

export function IconButton({ icon, label, onClick, disabled, primary, active, showLabel = true }: { icon: string; label: string; onClick?: () => void; disabled?: boolean; primary?: boolean; active?: boolean; showLabel?: boolean }) {
  return (
    <button type="button" className={'btn' + (primary ? ' primary' : '') + (active ? ' active' : '')} onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <Icon name={icon} />
      {showLabel && <span className="btn-label">{label}</span>}
    </button>
  );
}
