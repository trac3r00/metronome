let qrLibraryPromise = null;

export function bindShareModal({
  openButton,
  modal,
  qrTarget,
  urlText,
  copyButton,
  closeButton,
  nativeShareButton,
  fallbackHint,
}) {
  const getShareUrl = () => `${window.location.origin}/`;
  const shareSupported = hasNativeShare(navigator);

  if (nativeShareButton) {
    nativeShareButton.hidden = !shareSupported;
    const label = nativeShareButton.querySelector("[data-share-label]");
    if (label) {
      label.textContent = nativeShareLabel(navigator);
    }
  }
  if (fallbackHint) {
    fallbackHint.hidden = shareSupported;
  }

  const open = async () => {
    const shareUrl = getShareUrl();
    urlText.textContent = shareUrl;
    qrTarget.replaceChildren();
    try {
      await loadQrLibrary();
      new window.QRCode(qrTarget, {
        text: shareUrl,
        width: 192,
        height: 192,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } catch {
      // QR rendering is optional; the link is always available.
    }
    showModal(modal);
  };

  const close = () => modal.close();

  openButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    open().catch(() => {
      urlText.textContent = getShareUrl();
      showModal(modal);
    });
  });
  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    close();
  });
  copyButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    copyText(getShareUrl()).catch(() => {});
  });
  nativeShareButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (!hasNativeShare(navigator)) {
      return;
    }
    navigator.share(getNativeSharePayload(window.location)).catch(() => {});
  });
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) {
      close();
    }
  });
}

export function hasNativeShare(navigatorLike) {
  return typeof navigatorLike?.share === "function";
}

export function nativeShareLabel(navigatorLike) {
  const ua = String(navigatorLike?.userAgent ?? "");
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) {
    return "Share / AirDrop";
  }
  if (/Android/i.test(ua)) {
    return "Share";
  }
  return "Share";
}

export function getNativeSharePayload(locationLike) {
  return {
    title: "Church Metronome",
    url: locationLike.href,
  };
}

function showModal(modal) {
  if (typeof modal.showModal === "function") {
    if (!modal.open) {
      modal.showModal();
    }
    return;
  }
  modal.setAttribute("open", "");
}

function loadQrLibrary() {
  if (window.QRCode) {
    return Promise.resolve();
  }
  if (qrLibraryPromise) {
    return qrLibraryPromise;
  }
  qrLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/qrcode.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  return qrLibraryPromise;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("input");
  input.value = text;
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
