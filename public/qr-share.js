let qrLibraryPromise = null;

export function bindShareModal({
  openButton,
  modal,
  qrTarget,
  qrDetails,
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

  let qrRendered = false;
  const renderQr = async () => {
    if (qrRendered || !qrTarget) {
      return;
    }
    try {
      await loadQrLibrary();
      qrTarget.replaceChildren();
      new window.QRCode(qrTarget, {
        text: getShareUrl(),
        width: 192,
        height: 192,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
      qrRendered = true;
    } catch {
      // QR is optional — copy/share keep working.
    }
  };

  const open = () => {
    urlText.textContent = getShareUrl();
    if (qrDetails) {
      qrDetails.open = false;
      qrRendered = false;
    }
    showModal(modal);
  };

  const close = () => modal.close();

  qrDetails?.addEventListener("toggle", () => {
    if (qrDetails.open) {
      renderQr();
    }
  });

  openButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    open();
  });
  closeButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    close();
  });
  copyButton.addEventListener("pointerdown", async (event) => {
    event.preventDefault();
    try {
      await copyText(getShareUrl());
      flashLabel(copyButton, "Copied!");
    } catch {
      flashLabel(copyButton, "Copy failed");
    }
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
    title: "Metronome",
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

function flashLabel(button, message) {
  const labelHolder = button.querySelector("span:not([aria-hidden])");
  if (!labelHolder) {
    return;
  }
  const previous = labelHolder.textContent;
  labelHolder.textContent = message;
  setTimeout(() => {
    labelHolder.textContent = previous;
  }, 1400);
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
