"use client";

import { useState } from "react";

import type { ReaderLanguage } from "@/modules/reader/render-block";

type LanguageSwitchProps = {
  targetId: string;
};

function setReaderLanguage(targetId: string, language: ReaderLanguage): void {
  const root = document.getElementById(targetId);

  if (!root) {
    return;
  }

  root.dataset.language = language;

  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-reader-language]",
  )) {
    element.hidden = element.dataset.readerLanguage !== language;
  }
}

export function LanguageSwitch({ targetId }: LanguageSwitchProps) {
  const [language, setLanguage] = useState<ReaderLanguage>("zh");

  function activate(nextLanguage: ReaderLanguage): void {
    setLanguage(nextLanguage);
    setReaderLanguage(targetId, nextLanguage);
  }

  return (
    <div className="reader-language-switch" aria-label="Reader language">
      <button
        aria-pressed={language === "zh"}
        onClick={() => activate("zh")}
        type="button"
      >
        中文
      </button>
      <button
        aria-pressed={language === "en"}
        onClick={() => activate("en")}
        type="button"
      >
        English
      </button>
    </div>
  );
}
