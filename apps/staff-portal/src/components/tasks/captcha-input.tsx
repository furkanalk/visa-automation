"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";

interface CaptchaInputProps {
  imageUrl?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function CaptchaInput({
  imageUrl,
  value,
  onChange,
  disabled = false,
}: CaptchaInputProps) {
  const [zoom, setZoom] = useState(1);

  return (
    <div className="space-y-4">
      {/* CAPTCHA Image */}
      {imageUrl && (
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              CAPTCHA Image
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                disabled={zoom <= 1}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
                disabled={zoom >= 3}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-900 overflow-auto">
            <img
              src={imageUrl}
              alt="CAPTCHA"
              style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
              className="max-w-full transition-transform"
            />
          </div>
        </div>
      )}

      {/* Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Enter the text shown above
        </label>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type CAPTCHA text..."
          disabled={disabled}
          className="text-lg font-mono tracking-wider"
          autoComplete="off"
          autoFocus
        />
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Case-sensitive. Enter exactly as shown in the image.
      </p>
    </div>
  );
}
