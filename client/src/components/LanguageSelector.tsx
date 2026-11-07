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
    <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 shadow-sm hover:border-slate-400 transition">
      <Globe className="w-4 h-4 text-slate-500 shrink-0" />
      <select
        value={selectedLanguage}
        onChange={(e) => onSelectLanguage(e.target.value)}
        disabled={disabled}
        aria-label="Select customer language"
        className="bg-transparent text-xs font-semibold text-slate-800 outline-none cursor-pointer pr-1"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-white text-slate-900">
            {lang.native} ({lang.name})
          </option>
        ))}
      </select>
    </div>
  );
};
