"use client";

import React, { useState, useCallback, useRef } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Camera, Trash2, ZoomIn, ZoomOut, ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usersApi, attachmentsApi } from "@/lib/api";

interface AvatarUploadProps {
  avatarUrl: string | null;
  name: string;
  onAvatarChange: (url: string | null, key: string | null) => void;
}

async function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = new Image();
  // Needed so we can crop an existing S3 image onto a canvas without tainting it
  image.crossOrigin = "anonymous";
  image.src = imageSrc;
  await new Promise<void>((res, rej) => {
    image.onload = () => res();
    image.onerror = () => rej(new Error("Image load failed"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;

  // Circular clip
  ctx.beginPath();
  ctx.arc(200, 200, 200, 0, Math.PI * 2);
  ctx.clip();

  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, 400, 400
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas empty")), "image/jpeg", 0.92);
  });
}

export function AvatarUpload({ avatarUrl, name, onAvatarChange }: AvatarUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Clicking the avatar: if a photo exists, open the editor to re-adjust it;
  // otherwise jump straight to the file picker.
  function handleAvatarClick() {
    if (avatarUrl) {
      setCropSrc(avatarUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } else {
      fileRef.current?.click();
    }
  }

  function openPicker() {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCropSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    e.target.value = "";
  }

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleSave() {
    if (!cropSrc || !croppedAreaPixels) return;
    setUploading(true);
    setError("");
    try {
      const blob = await getCroppedBlob(cropSrc, croppedAreaPixels);
      const { presignedUrl, s3Key } = await usersApi.presignAvatar();

      const putRes = await fetch(presignedUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/jpeg" },
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      await usersApi.updateAvatar(s3Key);

      // Get display URL
      const { url } = await attachmentsApi.viewUrl(s3Key, true);
      onAvatarChange(url, s3Key);
      setCropSrc(null);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      await usersApi.deleteAvatar();
      onAvatarChange(null, null);
    } catch {
      setError("Delete failed. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="relative group w-20 h-20 shrink-0">
        {/* Avatar circle */}
        <div className="w-20 h-20 rounded-full bg-white dark:bg-muted border-4 border-card shadow-lg shadow-primary/25 overflow-hidden flex items-center justify-center text-primary text-3xl font-extrabold">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>

        {/* Camera overlay — click to edit existing or upload new */}
        <button
          onClick={handleAvatarClick}
          className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          title={avatarUrl ? "Adjust photo" : "Upload photo"}
        >
          <Camera className="w-6 h-6 text-white" />
        </button>

        {/* Delete badge — only when avatar exists */}
        {avatarUrl && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow-md hover:bg-destructive/90 transition-colors"
            title="Remove photo"
          >
            {deleting
              ? <div className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin" />
              : <Trash2 className="w-3 h-3" />}
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {error && <p className="text-xs text-destructive mt-1">{error}</p>}

      {/* Crop modal */}
      <Dialog open={!!cropSrc} onOpenChange={(o) => { if (!o) setCropSrc(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust your photo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Cropper area */}
            <div className="relative w-full h-72 bg-muted rounded-xl overflow-hidden">
              {cropSrc && (
                <Cropper
                  image={cropSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              )}
            </div>

            {/* Zoom slider */}
            <div className="flex items-center gap-3 px-1">
              <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Drag to reposition · Scroll or use slider to zoom
            </p>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={openPicker}
                disabled={uploading}
                className="gap-2"
              >
                <ImageUp className="w-4 h-4" />
                Change photo
              </Button>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setCropSrc(null)} disabled={uploading}>
                  Cancel
                </Button>
                <Button
                  className={cn("bg-primary hover:bg-primary/90 gap-2", uploading && "opacity-70")}
                  onClick={handleSave}
                  disabled={uploading}
                >
                  {uploading ? (
                    <><div className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> Uploading…</>
                  ) : "Save Photo"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
