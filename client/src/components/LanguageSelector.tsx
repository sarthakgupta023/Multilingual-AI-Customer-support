import React from 'react';
import { Globe } from 'lucide-react';

export interface LanguageOption {
  code: string;
  name: string;
  native: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
];

interface Props {
  selectedLanguage: string;
  onSelectLanguage: (code: string) => void;
  disabled?: boolean;
}

export const LanguageSelector: React.FC<Props> = ({ selectedLanguage, onSelectLanguage, disabled }) => {
  return (
    <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/60 rounded-xl px-3 py-1.5 shadow-sm">
      <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
      <select
        value={selectedLanguage}
        onChange={(e) => onSelectLanguage(e.target.value)}
        disabled={disabled}
        aria-label="Select preferred language"
        className="bg-transparent text-sm font-medium text-slate-200 outline-none cursor-pointer pr-2 hover:text-white transition"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-slate-800 text-slate-100">
            {lang.native} ({lang.name})
          </option>
        ))}
      </select>
    </div>
  );
};
