"""Audio features for the acoustic fault classifier and the engine fingerprint (numpy / scipy only)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

SR = 16000
N_FFT = 512
HOP = 256
N_MELS = 40


def load_wav(path: str | Path, seconds: float = 5.0) -> np.ndarray:
    sr, x = wavfile.read(str(path))
    x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if np.abs(x).max() > 1.5:  # integer PCM
        x = x / 32768.0
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    n = int(SR * seconds)
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    return x[:n]


@lru_cache(maxsize=1)
def mel_filterbank() -> np.ndarray:
    def hz2mel(h):
        return 2595 * np.log10(1 + h / 700.0)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595.0) - 1)

    mels = np.linspace(hz2mel(20), hz2mel(SR / 2), N_MELS + 2)
    bins = np.floor((N_FFT + 1) * mel2hz(mels) / SR).astype(int)
    fb = np.zeros((N_MELS, N_FFT // 2 + 1))
    for m in range(1, N_MELS + 1):
        lo, c, hi = bins[m - 1], bins[m], bins[m + 1]
        for k in range(lo, c):
            fb[m - 1, k] = (k - lo) / max(1, c - lo)
        for k in range(c, hi):
            fb[m - 1, k] = (hi - k) / max(1, hi - c)
    return fb


def spectrogram(x: np.ndarray) -> np.ndarray:
    win = np.hanning(N_FFT).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * win
    return np.abs(np.fft.rfft(frames, axis=1)) ** 2  # (frames, bins)


def log_mel(x: np.ndarray) -> np.ndarray:
    return np.log(spectrogram(x) @ mel_filterbank().T + 1e-9)  # (frames, mels)


def features(x: np.ndarray) -> np.ndarray:
    """140-dim clip descriptor: log-mel statistics, spectral shape, loudness and rhythm (knock/tick periodicity)."""
    x = x - x.mean()
    peak = np.abs(x).max()
    if peak > 0:
        x = x / peak
    spec = spectrogram(x)
    lm = np.log(spec @ mel_filterbank().T + 1e-9)
    lm_n = lm - lm.mean()
    d = np.diff(lm, axis=0)
    freqs = np.linspace(0, SR / 2, spec.shape[1])
    p = spec / (spec.sum(axis=1, keepdims=True) + 1e-12)
    centroid = (p * freqs).sum(axis=1)
    bandwidth = np.sqrt((p * (freqs - centroid[:, None]) ** 2).sum(axis=1))
    cum = np.cumsum(p, axis=1)
    rolloff = freqs[np.argmax(cum >= 0.85, axis=1)]
    flatness = np.exp(np.log(spec + 1e-12).mean(axis=1)) / (spec.mean(axis=1) + 1e-12)
    rms = np.sqrt((np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] ** 2).mean(axis=1))
    zcr = (np.abs(np.diff(np.sign(x))) > 0).reshape(-1)[: len(rms) * HOP].reshape(len(rms), -1).mean(axis=1) \
        if len(x) > len(rms) * HOP else np.zeros_like(rms)
    env = (rms - rms.mean()) / (rms.std() + 1e-9)
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    ac = ac / (ac[0] + 1e-9)
    lags = ac[2:40]  # 32 ms .. 640 ms: covers knock / tick / bearing periodicities at idle
    rhythm = [lags.max(), float(np.argmax(lags) + 2), ac[2:40].mean()]
    stats = lambda a: [float(np.mean(a)), float(np.std(a)), float(np.percentile(a, 10)), float(np.percentile(a, 90))]  # noqa: E731
    return np.concatenate([
        lm_n.mean(axis=0), lm.std(axis=0), np.abs(d).mean(axis=0),
        stats(centroid / 1000), stats(bandwidth / 1000), stats(rolloff / 1000), stats(np.log(flatness + 1e-9)),
        stats(np.log(rms + 1e-6)), stats(zcr), rhythm,
    ]).astype(np.float32)


def band_energy_profile(x: np.ndarray, n: int = 64) -> list[list[float]]:
    """Compact log-mel image (for the spectrogram shown in the examiner console)."""
    lm = log_mel(x)
    idx = np.linspace(0, lm.shape[0] - 1, n).astype(int)
    img = lm[idx].T
    img = (img - img.min()) / (np.ptp(img) + 1e-9)
    return np.round(img, 3).tolist()
