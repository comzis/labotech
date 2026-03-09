import React from 'react';
import { motion } from 'framer-motion';

export const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
};

export const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

export default function BentoCard({ title, icon: Icon, children, className = '', accentColor = 'cyan' }) {
    const accentGlow = accentColor === 'purple' ? 'group-hover:text-neon-purple' :
        accentColor === 'green' ? 'group-hover:text-neon-green' :
            'group-hover:text-neon-cyan';

    return (
        <motion.div
            variants={itemVariants}
            className={`bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-3xl p-6 relative overflow-hidden group ${className}`}
        >
            {/* Subtle Hover Glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

            <div className="flex items-center gap-2 mb-6 relative z-10">
                <Icon className={`w-5 h-5 text-gray-400 ${accentGlow} transition-colors`} strokeWidth={1.5} />
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.2em]">{title}</h3>
            </div>
            <div className="relative z-10">
                {children}
            </div>
        </motion.div>
    );
}
