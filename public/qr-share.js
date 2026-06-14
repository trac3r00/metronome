let qrLibraryPromise = null;

export function bindShareModal({ openButton, modal, qrTarget, urlText, copyButton, closeButton }) {
  const getShareUrl = () => `${window.location.origin}/`;

  const open = async () => {
    const shareUrl = getShareUrl();
    urlText.textContent = shareUrl;
    qrTarget.replaceChildren();
    await loadQrLibrary();
    new window.QRCode(qrTarget, {
      text: shareUrl,
      width: 192,
      height: 192,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    modal.showModal();
  };

  const close = () => modal.close();

  openButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    open().catch(() => {
      urlText.textContent = getShareUrl();
      modal.showModal();
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
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) {
      close();
    }
  });
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
