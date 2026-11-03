import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="help-btn" aria-label={text} onClick={() => setOpen((o) => !o)}>?</button>
      {open && <span className="help-pop" role="tooltip">{text}</span>}
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
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="ctrl-help">{help}</div>
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

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span /></span>
      <span>{label}</span>
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
