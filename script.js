// ========================================
// ① 状態管理
// ========================================

const state = {
    clips: [],
    selectedClipId: null,
    playheadTime: 0,
    playing: false,
    scale: 80,
    rafId: null,
    lastFrameTime: 0,
    objectUrls: new Set(),
    currentPreviewClipId: null
};

const FPS = 30;


// ========================================
// ② DOM要素の取得
// ========================================

const video = document.getElementById("previewVideo");
const fileInput = document.getElementById("fileInput");

const emptyPreview = document.getElementById("emptyPreview");
const previewStatus = document.getElementById("previewStatus");

const playButton = document.getElementById("playButton");
const backButton = document.getElementById("backButton");
const forwardButton = document.getElementById("forwardButton");

const timeDisplay = document.getElementById("timeDisplay");

const clipsElement = document.getElementById("clips");
const trackLane = document.getElementById("trackLane");
const timelineContent = document.getElementById("timelineContent");
const timelineScroll = document.getElementById("timelineScroll");
const ruler = document.getElementById("ruler");
const playhead = document.getElementById("playhead");

const splitButton = document.getElementById("splitButton");
const deleteButton = document.getElementById("deleteButton");

const noSelection = document.getElementById("noSelection");
const clipProperties = document.getElementById("clipProperties");

const clipName = document.getElementById("clipName");
const trimStart = document.getElementById("trimStart");
const trimEnd = document.getElementById("trimEnd");
const applyTrimButton = document.getElementById("applyTrimButton");

const exportButton = document.getElementById("exportButton");
const timelineDuration = document.getElementById("timelineDuration");
const message = document.getElementById("message");


// ========================================
// ③ クリップ管理
// ========================================

// 動画のインポート
async function importVideo(files) {
    for (const file of files) {
        if (!file.type.startsWith("video/")) continue;

        const url = URL.createObjectURL(file);
        state.objectUrls.add(url);

        const metadataVideo = document.createElement("video");
        metadataVideo.preload = "metadata";
        metadataVideo.src = url;

        try {
            await new Promise((resolve, reject) => {
                metadataVideo.onloadedmetadata = resolve;
                metadataVideo.onerror = reject;
            });

            const clip = {
                id: crypto.randomUUID(),
                file,
                url,
                name: file.name,
                sourceDuration: metadataVideo.duration,
                sourceStart: 0,
                sourceEnd: metadataVideo.duration,
                duration: metadataVideo.duration,
                fps: FPS
            };

            state.clips.push(clip);
            state.selectedClipId = clip.id;

        } catch {
            URL.revokeObjectURL(url);
            state.objectUrls.delete(url);
            showMessage("動画を読み込めませんでした");
        }
    }

    renderAll();
    updateClipProperties();
    syncPreview();
}

// クリップの追加
function addClip(clip) {
    state.clips.push(clip);
    renderAll();
}

// クリップの削除
function removeClip(id) {
    const index = state.clips.findIndex(c => c.id === id);
    if (index === -1) return;

    const [removed] = state.clips.splice(index, 1);

    if (!state.clips.some(c => c.url === removed.url)) {
        URL.revokeObjectURL(removed.url);
        state.objectUrls.delete(removed.url);
    }

    if (state.selectedClipId === id) {
        state.selectedClipId = null;
    }

    renderAll();
    updateClipProperties();
    seekTo(Math.min(state.playheadTime, getTotalDuration()));
}

// 時刻からクリップを取得
function getClipAt(time) {
    let start = 0;

    for (const clip of state.clips) {
        const end = start + clip.duration;

        if (time >= start && time < end) {
            return {
                clip,
                localTime: time - start,
                timelineStart: start
            };
        }

        start = end;
    }

    return null;
}

// クリップの開始時刻
function getClipStart(id) {
    let time = 0;

    for (const clip of state.clips) {
        if (clip.id === id) return time;
        time += clip.duration;
    }

    return null;
}

// 合計時間
function getTotalDuration() {
    return state.clips.reduce(
        (total, clip) => total + clip.duration,
        0
    );
}


// ========================================
// ④ タイムライン管理
// ========================================

// 時刻から座標へ
function timeToPosition(time) {
    return time * state.scale;
}

// 座標から時刻へ
function positionToTime(position) {
    return position / state.scale;
}

// 再生位置の変更
function seekTo(time) {
    pausePlayback();

    state.playheadTime = Math.max(
        0,
        Math.min(time, getTotalDuration())
    );

    syncPreview();
    updateTimeDisplay();
    updatePlayhead();
}

// タイムラインの描画
function renderTimeline() {
    const total = getTotalDuration();
    const width = Math.max(
        timelineScroll.clientWidth - 30,
        timeToPosition(total) + 100
    );

    timelineContent.style.width = `${width}px`;

    clipsElement.innerHTML = "";

    let start = 0;

    state.clips.forEach(clip => {
        const element = document.createElement("div");

        element.className = "clip";
        if (clip.id === state.selectedClipId) {
            element.classList.add("selected");
        }

        element.textContent = clip.name;
        element.style.left = `${timeToPosition(start)}px`;
        element.style.width = `${timeToPosition(clip.duration)}px`;

        element.addEventListener("click", event => {
            event.stopPropagation();
            state.selectedClipId = clip.id;
            renderTimeline();
            updateClipProperties();
        });

        clipsElement.appendChild(element);
        start += clip.duration;
    });

    renderRuler(width);
    updatePlayhead();

    timelineDuration.textContent =
        `合計 ${formatTime(total)}`;
}

// 目盛りの描画
function renderRuler(width) {
    ruler.innerHTML = "";

    const interval = 1;

    for (let t = 0; t <= width / state.scale; t += interval) {
        const mark = document.createElement("span");

        mark.textContent = `${t}s`;
        mark.style.left = `${timeToPosition(t)}px`;

        ruler.appendChild(mark);
    }
}

// 再生ヘッドの更新
function updatePlayhead() {
    playhead.style.left =
        `${timeToPosition(state.playheadTime)}px`;
}


// ========================================
// ⑤ プレビュー制御
// ========================================

// プレビューの更新
function syncPreview() {
    const current = getClipAt(state.playheadTime);

    if (!current) {
        video.pause();
        video.removeAttribute("src");
        video.load();

        state.currentPreviewClipId = null;
        emptyPreview.hidden = false;
        previewStatus.textContent = "READY";
        return;
    }

    const { clip, localTime } = current;
    const sourceTime = clip.sourceStart + localTime;

    emptyPreview.hidden = true;

    if (state.currentPreviewClipId !== clip.id) {
        video.src = clip.url;
        video.load();

        state.currentPreviewClipId = clip.id;
    }

    video.pause();

    if (Math.abs(video.currentTime - sourceTime) > 0.02) {
        video.currentTime = sourceTime;
    }

    previewStatus.textContent = clip.name;
}

// 再生
function playPlayback() {
    if (state.playing || !state.clips.length) return;

    if (state.playheadTime >= getTotalDuration()) {
        state.playheadTime = 0;
        syncPreview();
    }

    const current = getClipAt(state.playheadTime);
    if (!current) return;

    state.playing = true;
    state.lastFrameTime = performance.now();

    playButton.textContent = "Ⅱ";

    video.play().catch(() => {});

    state.rafId = requestAnimationFrame(playLoop);
}

// 再生ループ
function playLoop(now) {
    if (!state.playing) return;

    const elapsed = (now - state.lastFrameTime) / 1000;
    state.lastFrameTime = now;

    state.playheadTime += elapsed;

    if (state.playheadTime >= getTotalDuration()) {
        state.playheadTime = getTotalDuration();
        pausePlayback();
    } else {
        const current = getClipAt(state.playheadTime);

        if (current?.clip.id !== state.currentPreviewClipId) {
            syncPreview();
            video.play().catch(() => {});
        }
    }

    updatePlayhead();
    updateTimeDisplay();

    if (state.playing) {
        state.rafId = requestAnimationFrame(playLoop);
    }
}

// 一時停止
function pausePlayback() {
    state.playing = false;

    cancelAnimationFrame(state.rafId);
    video.pause();

    playButton.textContent = "▶";
}

// 1フレーム移動
function moveFrame(direction) {
    pausePlayback();

    const total = getTotalDuration();
    if (!total) return;

    const current = getClipAt(state.playheadTime);

    if (!current) {
        if (direction < 0) {
            const lastClip = state.clips[state.clips.length - 1];
            const start = getClipStart(lastClip.id);

            state.playheadTime =
                start + Math.max(0, lastClip.duration - 1 / FPS);
        }

        syncPreview();
        updateTimeDisplay();
        updatePlayhead();
        return;
    }

    const { clip, localTime, timelineStart } = current;

    const sourceTime = clip.sourceStart + localTime;

    const frameIndex = Math.round(sourceTime * clip.fps);

    const nextSourceTime =
        (frameIndex + direction) / clip.fps;

    const nextLocalTime =
        nextSourceTime - clip.sourceStart;

    const nextTime =
        timelineStart + nextLocalTime;

    seekTo(Math.max(
        timelineStart,
        Math.min(nextTime, timelineStart + clip.duration)
    ));
}


// ========================================
// ⑥ 編集操作
// ========================================

// クリップの分割
function splitClip() {
    const current = getClipAt(state.playheadTime);
    if (!current) return;

    const { clip, localTime, timelineStart } = current;

    if (localTime <= 0.001 ||
        localTime >= clip.duration - 0.001) {
        showMessage("この位置では分割できません");
        return;
    }

    const splitSourceTime = clip.sourceStart + localTime;

    const secondClip = {
        ...clip,
        id: crypto.randomUUID(),
        sourceStart: splitSourceTime,
        duration: clip.sourceEnd - splitSourceTime
    };

    clip.sourceEnd = splitSourceTime;
    clip.duration = localTime;

    const index = state.clips.indexOf(clip);

    state.clips.splice(index + 1, 0, secondClip);

    state.selectedClipId = secondClip.id;

    renderAll();
    updateClipProperties();

    seekTo(timelineStart + localTime);
    showMessage("クリップを分割しました");
}

// トリミング
function trimClip() {
    const clip = state.clips.find(
        c => c.id === state.selectedClipId
    );

    if (!clip) return;

    const start = Number(trimStart.value);
    const end = Number(trimEnd.value);

    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end > clip.sourceDuration ||
        start >= end
    ) {
        showMessage("時間の指定が正しくありません");
        return;
    }

    const oldTimelineStart = getClipStart(clip.id);

    clip.sourceStart = start;
    clip.sourceEnd = end;
    clip.duration = end - start;

    renderAll();
    updateClipProperties();

    seekTo(oldTimelineStart);
    showMessage("トリミングしました");
}

// 選択クリップの削除
function deleteSelectedClip() {
    if (!state.selectedClipId) return;

    removeClip(state.selectedClipId);
    showMessage("クリップを削除しました");
}


// ========================================
// ⑦ 画面更新
// ========================================

// 時間表示
function updateTimeDisplay() {
    timeDisplay.textContent =
        formatTime(state.playheadTime, true);
}

// クリップ設定の表示
function updateClipProperties() {
    const clip = state.clips.find(
        c => c.id === state.selectedClipId
    );

    noSelection.hidden = !!clip;
    clipProperties.hidden = !clip;

    if (!clip) return;

    clipName.textContent = clip.name;
    trimStart.value = clip.sourceStart.toFixed(3);
    trimEnd.value = clip.sourceEnd.toFixed(3);

    trimStart.max = clip.sourceDuration;
    trimEnd.max = clip.sourceDuration;
}

// 時間の書式
function formatTime(seconds, milliseconds = false) {
    const safe = Math.max(0, seconds);

    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const ms = Math.floor((safe % 1) * 1000);

    const base =
        `${String(minutes).padStart(2, "0")}:` +
        `${String(secs).padStart(2, "0")}`;

    if (!milliseconds) return base;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return (
        `${String(hours).padStart(2, "0")}:` +
        `${String(remainingMinutes).padStart(2, "0")}:` +
        `${String(secs).padStart(2, "0")}.` +
        `${String(ms).padStart(3, "0")}`
    );
}

// メッセージ
function showMessage(text) {
    message.textContent = text;
}


// ========================================
// ⑧ 動画のエクスポート
// ========================================

async function exportVideo() {
    if (!state.clips.length) {
        showMessage("書き出す動画がありません");
        return;
    }

    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        showMessage("このブラウザは書き出しに対応していません");
        return;
    }

    pausePlayback();

    exportButton.disabled = true;
    exportButton.textContent = "書き出し中...";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const exportVideoElement = document.createElement("video");
    exportVideoElement.muted = true;
    exportVideoElement.playsInline = true;

    try {
        const firstClip = state.clips[0];

        exportVideoElement.src = firstClip.url;
        await waitForMetadata(exportVideoElement);

        canvas.width = exportVideoElement.videoWidth;
        canvas.height = exportVideoElement.videoHeight;

        const stream = canvas.captureStream(FPS);

        const mimeType = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm"
        ].find(type => MediaRecorder.isTypeSupported(type));

        if (!mimeType) {
            throw new Error("WebM形式に対応していません");
        }

        const recorder = new MediaRecorder(stream, {
            mimeType
        });

        const chunks = [];

        recorder.ondataavailable = event => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        const recordingFinished = new Promise(resolve => {
            recorder.onstop = resolve;
        });

        recorder.start();

        for (const clip of state.clips) {
            exportVideoElement.src = clip.url;

            await waitForMetadata(exportVideoElement);

            exportVideoElement.currentTime = clip.sourceStart;
            await waitForSeek(exportVideoElement);

            while (
                exportVideoElement.currentTime < clip.sourceEnd
            ) {
                ctx.drawImage(
                    exportVideoElement,
                    0, 0,
                    canvas.width,
                    canvas.height
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 1000 / FPS)
                );

                if (exportVideoElement.paused) {
                    await exportVideoElement.play();
                }

                if (exportVideoElement.currentTime >= clip.sourceEnd) {
                    break;
                }
            }

            exportVideoElement.pause();
        }

        recorder.stop();
        await recordingFinished;

        const blob = new Blob(chunks, {
            type: mimeType
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "edited-video.webm";
        link.click();

        URL.revokeObjectURL(url);

        stream.getTracks().forEach(track => track.stop());

        showMessage("書き出しが完了しました");

    } catch (error) {
        console.error(error);
        showMessage("書き出しに失敗しました");

    } finally {
        exportVideoElement.pause();
        exportVideoElement.removeAttribute("src");
        exportVideoElement.load();

        exportButton.disabled = false;
        exportButton.textContent = "動画を書き出す";
    }
}

// メタデータ読み込み待ち
function waitForMetadata(element) {
    if (element.readyState >= 1) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        element.onloadedmetadata = resolve;
        element.onerror = reject;
    });
}

// シーク完了待ち
function waitForSeek(element) {
    return new Promise(resolve => {
        if (element.seeking) {
            element.addEventListener("seeked", resolve, {
                once: true
            });
        } else {
            resolve();
        }
    });
}


// ========================================
// ⑨ イベント設定
// ========================================

// インポート
fileInput.addEventListener("change", async () => {
    await importVideo(fileInput.files);
    fileInput.value = "";
});

// 再生・一時停止
playButton.addEventListener("click", () => {
    if (state.playing) {
        pausePlayback();
    } else {
        playPlayback();
    }
});

// フレーム移動
backButton.addEventListener("click", () => {
    moveFrame(-1);
});

forwardButton.addEventListener("click", () => {
    moveFrame(1);
});

// 分割・削除
splitButton.addEventListener("click", splitClip);
deleteButton.addEventListener("click", deleteSelectedClip);

// トリミング
applyTrimButton.addEventListener("click", trimClip);

// エクスポート
exportButton.addEventListener("click", exportVideo);

// タイムラインクリック
trackLane.addEventListener("click", event => {
    const rect = trackLane.getBoundingClientRect();
    const x = event.clientX - rect.left;

    seekTo(positionToTime(x));
});

// キーボード操作
document.addEventListener("keydown", event => {
    if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
    ) return;

    if (event.code === "Space") {
        event.preventDefault();

        if (state.playing) {
            pausePlayback();
        } else {
            playPlayback();
        }
    }

    if (event.code === "ArrowLeft") {
        moveFrame(-1);
    }

    if (event.code === "ArrowRight") {
        moveFrame(1);
    }
});

// 画面サイズ変更
window.addEventListener("resize", renderTimeline);


// ========================================
// ⑩ 初期化
// ========================================

renderAll();

function renderAll() {
    renderTimeline();
    updateTimeDisplay();
    updatePlayhead();
}

updateClipProperties();
syncPreview();
