"use client";

import Image from "next/image";
import { ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { assetUrl } from "@/lib/api";

const maxBytes = 5 * 1024 * 1024;
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function LogoUploadField({
  value,
  busy = false,
  onFile,
  onRemove,
  onClearSelection,
}: {
  value?: string | null;
  busy?: boolean;
  onFile: (file: File) => void;
  onRemove?: () => void;
  onClearSelection?: () => void;
}) {
  const inputId = useId();
  const [selection, setSelection] = useState<File | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const previewUrl = useRef<string | null>(null);
  const image = selectionPreview || assetUrl(value);

  useEffect(() => {
    return () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); };
  }, []);

  const setSelectedFile = (file: File | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = file ? URL.createObjectURL(file) : null;
    setSelectionPreview(previewUrl.current);
    setSelection(file);
  };

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (!acceptedTypes.has(file.type)) {
      setValidationError("This file wasn’t selected. Choose a PNG, JPG, GIF, or WebP image.");
      return;
    }
    if (file.size > maxBytes) {
      setValidationError("This file wasn’t selected. Choose an image that is 5 MB or smaller.");
      return;
    }
    setValidationError("");
    setSelectedFile(file);
    onFile(file);
  };

  return (
    <div className="mt-logo-upload">
      <input
        id={inputId}
        className="mt-logo-upload__input"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        disabled={busy}
        aria-describedby={`${inputId}-help${validationError ? ` ${inputId}-error` : ""}`}
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="mt-logo-upload__card">
        <div className="mt-logo-upload__preview">
          {image ? <Image src={image} alt="Business logo preview" fill sizes="58px" unoptimized /> : <ImagePlus size={23} aria-hidden="true" />}
        </div>
        <div className="mt-logo-upload__copy">
          <strong>{selection?.name || (value ? "Business logo added" : "Add your business logo")}</strong>
          <p id={`${inputId}-help`}>PNG, JPG, GIF or WebP · 5 MB max</p>
          {busy ? (
            <span className="mt-logo-upload__busy"><LoaderCircle size={14} className="mt-kiosk-spin" /> Uploading…</span>
          ) : (
            <div className="mt-logo-upload__actions">
              <label className="mt-logo-upload__choose" htmlFor={inputId} aria-disabled={busy}>
                <Upload size={13} aria-hidden="true" />
                {value || selection ? "Change logo" : "Choose logo"}
              </label>
              {selection && onClearSelection && <button className="mt-logo-upload__remove" type="button" onClick={() => { setSelectedFile(null); setValidationError(""); onClearSelection(); }}>Clear</button>}
              {!selection && value && onRemove && <button className="mt-logo-upload__remove" type="button" onClick={onRemove}>Remove</button>}
            </div>
          )}
        </div>
      </div>
      {validationError && <p id={`${inputId}-error`} className="mt-logo-upload__error" role="alert">{validationError}</p>}
    </div>
  );
}
