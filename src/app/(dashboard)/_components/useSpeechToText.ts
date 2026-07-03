"use client";

import { useEffect, useRef, useState } from "react";

// Web Speech API dictation, shared by the create-case inbox and the editable
// report popup. `onFinalText` is called with each finalized chunk; the caller
// decides how to append it. Mirrors the implementation in CreateCaseForm.

type SpeechRecognitionResult = { transcript: string };
type SpeechRecognitionAlternatives = ArrayLike<SpeechRecognitionResult> & {
  isFinal?: boolean;
};
type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionAlternatives>;
};
type SpeechRecognitionErrorEvent = Event & { error?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  addEventListener: (
    type: "result" | "error" | "end" | "start",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (event: any) => void
  ) => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const READY_STATUS = "Speech input is ready. You can type anytime.";

export function useSpeechToText(onFinalText: (text: string) => void) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState(READY_STATUS);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const onFinalRef = useRef(onFinalText);

  useEffect(() => {
    onFinalRef.current = onFinalText;
  }, [onFinalText]);

  useEffect(() => {
    const w = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      setStatus("Speak-to-Text is not supported in this browser. Please type your message.");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("start", () => {
      listeningRef.current = true;
      setListening(true);
      setStatus("Listening… click the mic again to stop.");
    });

    recognition.addEventListener("result", (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alt = event.results[i];
        const transcript = alt?.[0]?.transcript ?? "";
        if (alt?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      const finalized = finalText.trim();
      if (finalized) onFinalRef.current(finalized);
      const interim = interimText.trim();
      if (interim) setStatus(`Listening… "${interim}"`);
      else if (finalized) setStatus("Listening… keep talking, or click the mic to stop.");
    });

    recognition.addEventListener("error", (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || "";
      if (code === "no-speech") {
        setStatus("Didn't catch that. Click the mic to try again.");
      } else if (code === "not-allowed" || code === "service-not-allowed") {
        setStatus(
          "Microphone is blocked. Click the lock or 🎤 icon in your browser's address bar, set Microphone to Allow for this site, then click the mic again."
        );
      } else if (code === "aborted") {
        setStatus("Speech capture stopped.");
      } else if (code === "audio-capture") {
        setStatus(
          "No microphone was detected. Plug one in (or check OS sound settings) and try again."
        );
      } else if (code === "network") {
        setStatus("Speech service couldn't reach the network. Check your connection.");
      } else {
        setStatus("Speech capture failed. Please type your message.");
      }
    });

    recognition.addEventListener("end", () => {
      listeningRef.current = false;
      setListening(false);
      setStatus((prev) =>
        prev.startsWith("Listening")
          ? "Speech captured. Click the mic to dictate again."
          : prev
      );
    });

    recognitionRef.current = recognition;

    return () => {
      try {
        if (listeningRef.current) recognition.abort();
      } catch {
        // best effort
      }
    };
  }, []);

  const toggle = async () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listeningRef.current) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus(
        "Speech input needs a secure (https://) connection. Reload over https or use localhost."
      );
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus(
          "Microphone is blocked. Click the lock or 🎤 icon in your browser's address bar, set Microphone to Allow for this site, then click the mic again."
        );
        return;
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus(
          "No microphone was detected. Plug one in (or check OS sound settings) and try again."
        );
        return;
      }
    }
    try {
      recognition.start();
    } catch {
      setStatus("Unable to start speech capture. Please try again or type manually.");
    }
  };

  return { supported, listening, status, toggle };
}
