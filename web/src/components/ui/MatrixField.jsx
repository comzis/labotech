import React from 'react';

export function Field({ label, value, onChange, color = 'cyan', ...props }) {
    const focusColor = color === 'cyan' ? 'focus:border-neon-cyan/50 focus:bg-neon-cyan/5' :
        color === 'green' ? 'focus:border-neon-green/50 focus:bg-neon-green/5' :
            'focus:border-neon-purple/50 focus:bg-neon-purple/5';

    const textColor = color === 'cyan' ? 'text-neon-cyan/90' :
        color === 'green' ? 'text-neon-green/90' :
            'text-neon-purple/90';

    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">{label}</label>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                {...props}
                className={`w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none transition-all placeholder:text-gray-600 ${focusColor} ${props.type === 'number' || props.className?.includes('font-mono') ? 'font-mono' : ''}`}
            />
        </div>
    );
}

export function SelectField({ label, options, value, onChange, color = 'cyan', ...props }) {
    const focusColor = color === 'cyan' ? 'focus:border-neon-cyan/50 focus:bg-neon-cyan/5' :
        color === 'green' ? 'focus:border-neon-green/50 focus:bg-neon-green/5' :
            'focus:border-neon-purple/50 focus:bg-neon-purple/5';

    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">{label}</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                {...props}
                className={`w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none transition-all appearance-none cursor-pointer ${focusColor}`}
                style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%239ca3af" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
                {options.map(o => {
                    const isObj = typeof o === 'object';
                    return <option key={isObj ? o.value : o} value={isObj ? o.value : o} className="bg-midnight-surface">{isObj ? o.label : o}</option>
                })}
            </select>
        </div>
    );
}

export function PidField({ label, value, onChange }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pl-1">{label}</label>
            <input
                type="number" value={value} onChange={e => onChange(e.target.value)} min="1" max="65535"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-neon-purple/90 font-mono focus:outline-none focus:border-neon-purple/50 focus:bg-neon-purple/5 transition-all"
            />
        </div>
    );
}
