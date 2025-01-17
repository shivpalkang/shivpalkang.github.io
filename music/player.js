const PLAYER_JS_T = {
    listen: 'Listen',
    mute: 'Mute',
    pause: 'Pause',
    playbackPosition: 'Playback position',
    playerClosed: 'Player closed',
    playerOpenPlayingXxx: title => 'Player open, playing {title}'.replace('{title}', title),
    unmute: 'Unmute',
    volume: 'Volume',
    xxxHours: hours => '{xxx} hours'.replace('{xxx}', hours),
    xxxMinutes: minutes => '{xxx} minutes'.replace('{xxx}', minutes),
    xxxSeconds: seconds => '{xxx} seconds'.replace('{xxx}', seconds)
};
const loadingIcon = document.querySelector('#loading_icon');
const pauseIcon = document.querySelector('#pause_icon');
const playIcon = document.querySelector('#play_icon');

const listenButton = document.querySelector('button.listen');
const listenButtonIcon = document.querySelector('button.listen .icon');
const listenButtonLabel = document.querySelector('button.listen .label');

let activeTrack = null;
let firstTrack = null;
let preselectedTrack = null;

const dockedPlayerContainer = document.querySelector('.docked_player');
const dockedPlayer = {
    container: dockedPlayerContainer,
    currentTime: dockedPlayerContainer.querySelector('.time .current'),
    nextTrackButton: dockedPlayerContainer.querySelector('button.next_track'),
    number: dockedPlayerContainer.querySelector('.number'),
    playbackButton: dockedPlayerContainer.querySelector('button.playback'),
    progress: dockedPlayerContainer.querySelector('.progress'),
    status: document.querySelector('.docked_player_status'),
    timeline: dockedPlayerContainer.querySelector('.timeline'),
    timelineInput: dockedPlayerContainer.querySelector('.timeline input'),
    titleWrapper: dockedPlayerContainer.querySelector('.title_wrapper'),
    totalTime: dockedPlayerContainer.querySelector('.time .total'),
    volumeButton: dockedPlayerContainer.querySelector('.volume button'),
    volumeInput: dockedPlayerContainer.querySelector('.volume input'),
    volumeSvgTitle: dockedPlayerContainer.querySelector('.volume svg title')
};

let globalUpdatePlayHeadInterval;

const volume = {
    container: document.querySelector('.volume'),
    level: 1
};

const persistedVolume = localStorage.getItem('faircampVolume');
if (persistedVolume !== null) {
    const level = parseFloat(persistedVolume);
    if (level >= 0 && level <= 1) {
        volume.level = level;
    }
}
updateVolume();

function formatTime(seconds) {
    if (seconds < 60) {
        return `0:${Math.floor(seconds).toString().padStart(2, '0')}`;
    } else {
        const secondsFormatted = Math.floor(seconds % 60).toString().padStart(2, '0');
        if (seconds < 3600) {
            return `${Math.floor(seconds / 60)}:${secondsFormatted}`;
        } else {
            return `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${secondsFormatted}`;
        }
    }
}

function formatTimeWrittenOut(seconds) {
    if (seconds < 60) {
        return PLAYER_JS_T.xxxSeconds(Math.floor(seconds));
    } else {
        const secondsWrittenOut = PLAYER_JS_T.xxxSeconds(Math.floor(Math.floor(seconds % 60)));
        if (seconds < 3600) {
            return `${PLAYER_JS_T.xxxMinutes(Math.floor(seconds / 60))} ${secondsWrittenOut}`;
        } else {
            return `${PLAYER_JS_T.xxxHours(Math.floor(seconds / 3600))} ${PLAYER_JS_T.xxxMinutes(Math.floor((seconds % 3600) / 60))} ${secondsWrittenOut}`;
        }
    }
}

async function mountAndPlay(track, seekTo) {
    activeTrack = track;

    document.body.classList.add('player_active');
    dockedPlayer.status.setAttribute('aria-label', PLAYER_JS_T.playerOpenPlayingXxx(track.title.textContent));
    dockedPlayer.currentTime.textContent = '0:00';
    dockedPlayer.totalTime.textContent = formatTime(activeTrack.duration);
    dockedPlayer.timelineInput.max = track.container.dataset.duration;

    if (track.artists) {
        dockedPlayer.titleWrapper.replaceChildren(track.title.cloneNode(true), track.artists.cloneNode(true));
    } else {
        dockedPlayer.titleWrapper.replaceChildren(track.title.cloneNode(true));
    }

    // Not available on a track player
    if (dockedPlayer.number) {
        dockedPlayer.nextTrackButton.toggleAttribute('disabled', !track.nextTrack);
        dockedPlayer.number.textContent = track.number.textContent;
    }

    updateVolume();

    // The pause and loading icon are visually indistinguishable (until the
    // actual loading animation kicks in after 500ms), hence we right away
    // transistion to the loading icon to make the interface feel snappy,
    // even if we potentially replace it with the pause icon right after that
    // if there doesn't end up to be any loading required.
    track.container.classList.add('active');
    track.playbackButtonIcon.replaceChildren(loadingIcon.content.cloneNode(true));
    dockedPlayer.playbackButton.replaceChildren(loadingIcon.content.cloneNode(true));
    listenButtonIcon.replaceChildren(loadingIcon.content.cloneNode(true));
    listenButtonLabel.textContent = PLAYER_JS_T.pause;

    if (track.audio.preload !== 'auto') {
        track.audio.preload = 'auto';
        track.audio.load();
    }

    const play = () => {
        track.audio.volume = volume.level;
        track.audio.play();
    };

    if (seekTo === null) {
        play();
    } else {
        const seeking = {
            to: seekTo
        };

        let closestPerformedSeek = 0;

        function tryFinishSeeking() {
            let closestAvailableSeek = 0;
            const { seekable } = track.audio;
            for (let index = 0; index < seekable.length; index++) {
                if (seekable.start(index) <= seeking.to) {
                    if (seekable.end(index) >= seeking.to) {
                        track.audio.currentTime = seeking.to;
                        delete track.seeking;
                        clearInterval(seekInterval);
                        play();
                    } else {
                        closestAvailableSeek = seekable.end(index);
                    }
                } else {
                    break;
                }
            }

            // If we can not yet seek to exactly the point we want to get to,
            // but we can get at least one second closer to that point, we do it.
            // (the idea being that this more likely triggers preloading of the
            // area that we need to seek to)
            if (seeking.to !== null && closestAvailableSeek - closestPerformedSeek > 1) {
                track.audio.currentTime = closestAvailableSeek;
                closestPerformedSeek = closestAvailableSeek;
            }
        }

        const seekInterval = setInterval(tryFinishSeeking, 30);

        seeking.abortSeeking = () => {
            clearInterval(seekInterval);
            delete track.seeking;
            dockedPlayer.playbackButton.replaceChildren(playIcon.content.cloneNode(true));
            track.container.classList.remove('active');
            track.playbackButtonIcon.replaceChildren(playIcon.content.cloneNode(true));
            listenButtonIcon.replaceChildren(playIcon.content.cloneNode(true));
            listenButtonLabel.textContent = PLAYER_JS_T.listen;
        };

        // We expose both `abortSeeking` and `seek` on this seeking object,
        // so that consecutive parallel playback requests may either abort
        // seeking or reconfigure up to which time seeking should occur (seek).
        track.seeking = seeking;
    }
}

function togglePlayback(track, seekTo = null) {
    if (preselectedTrack !== null) {
        if (track !== preselectedTrack) {
            preselectedTrack.container.classList.remove('active');
        }

        preselectedTrack = null;
    }

    if (!activeTrack) {
        mountAndPlay(track, seekTo);
    } else if (track === activeTrack) {
        if (track.seeking) {
            if (seekTo === null) {
                track.seeking.abortSeeking();
            } else {
                track.seeking.to = seekTo;
            }
        } else if (track.audio.paused) {
            if (seekTo !== null) {
                // TODO: Needs to be wrapped in an async mechanism that first ensures we can seek to that point
                track.audio.currentTime = seekTo;
            }
            track.audio.play();
        } else {
            // This track is playing, we either pause it, or perform a seek
            if (seekTo === null) {
                track.audio.pause();
            } else {
                // TODO: Needs to be wrapped in an async mechanism that first ensures we can seek to that point
                track.audio.currentTime = seekTo;
                updatePlayhead(track);
                announcePlayhead(track);
            }
        }
    } else {
        // Another track is active, so we either abort its loading (if applies) or
        // pause it (if necessary) and reset it. Then we start the new track.
        if (activeTrack.loading) {
            activeTrack.loading.abortSeeking();
            mountAndPlay(track, seekTo);
        } else {
            const resetCurrentStartNext = () => {
                activeTrack.audio.currentTime = 0;
                updatePlayhead(activeTrack, true);
                announcePlayhead(activeTrack);
                activeTrack.container.classList.remove('active');

                mountAndPlay(track, seekTo);
            }

            if (activeTrack.audio.paused) {
                resetCurrentStartNext();
            } else {
                // The pause event occurs with a delay, so we defer resetting the track
                // and starting the next one until just after the pause event fires.
                activeTrack.onPause = resetCurrentStartNext;
                activeTrack.audio.pause();
            }

        }
    }
}

// While the underlying data model of the playhead (technically the invisible
// range input and visible svg representation) change granularly, we only
// trigger screenreader announcements when it makes sense - e.g. when
// focusing the range input, when seeking, when playback ends etc.
function announcePlayhead(track) {
    const valueText = `${PLAYER_JS_T.playbackPosition} ${formatTimeWrittenOut(dockedPlayer.timelineInput.value)}`;

    dockedPlayer.timelineInput.setAttribute('aria-valuetext', valueText);

    if (track.waveform) {
        track.waveform.input.setAttribute('aria-valuetext', valueText);
    }
}

function updatePlayhead(track, reset = false) {
    const { audio } = track;
    const factor = reset ? 0 : audio.currentTime / track.duration;

    dockedPlayer.progress.style.setProperty('width', `${factor * 100}%`);
    dockedPlayer.currentTime.textContent = formatTime(audio.currentTime);
    dockedPlayer.timelineInput.value = audio.currentTime;

    if (track.waveform) {
        track.waveform.svg.querySelector('linearGradient.playback stop:nth-child(1)').setAttribute('offset', factor);
        track.waveform.svg.querySelector('linearGradient.playback stop:nth-child(2)').setAttribute('offset', factor + 0.0001);
        track.waveform.input.value = audio.currentTime;
    }
}

function updateVolume(restoreLevel = null) {
    if (activeTrack) {
        activeTrack.audio.volume = volume.level;
    }

    localStorage.setItem('faircampVolume', volume.level.toString());

    const RADIUS = 32;
    const degToRad = deg => (deg * Math.PI) / 180;

    // Compute a path's d attribute for a ring segment.
    // In clock terms we start at 12 o'clock and we go clockwise.
    const segmentD = (beginAngle, arcAngle) => {
        let largeArcFlag = arcAngle < 180 ? 0 : 1 ;

        let beginAngleRad = degToRad(beginAngle);
        let beginX = Math.sin(beginAngleRad);
        let beginY = -Math.cos(beginAngleRad);

        let endAngleRad = degToRad(beginAngle + arcAngle);
        let endX = Math.sin(endAngleRad);
        let endY = -Math.cos(endAngleRad);

        const outerRadius = RADIUS;
        let segmentOuterBeginX = RADIUS + beginX * outerRadius;
        let segmentOuterBeginY = RADIUS + beginY * outerRadius;

        let segmentOuterEndX = RADIUS + endX * outerRadius;
        let segmentOuterEndY = RADIUS + endY * outerRadius;

        let innerRadius = RADIUS * 0.8;
        let segmentInnerBeginX = RADIUS + beginX * innerRadius;
        let segmentInnerBeginY = RADIUS + beginY * innerRadius;

        let segmentInnerEndX = RADIUS + endX * innerRadius;
        let segmentInnerEndY = RADIUS + endY * innerRadius;

        return `
            M ${segmentOuterBeginX},${segmentOuterBeginY}
            A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${segmentOuterEndX},${segmentOuterEndY}
            L ${segmentInnerEndX},${segmentInnerEndY}
            A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${segmentInnerBeginX},${segmentInnerBeginY}
            Z
        `;
    };

    dockedPlayer.volumeButton.classList.toggle('muted', volume.level === 0);
    dockedPlayer.volumeSvgTitle.textContent = volume.level > 0 ? PLAYER_JS_T.mute : PLAYER_JS_T.unmute;

    const beginAngle = -135;
    const arcAngle = volume.level * 270;

    const knobAngle = beginAngle + arcAngle;
    dockedPlayer.volumeButton.querySelector('path.knob').setAttribute('transform', `rotate(${knobAngle} 32 32)`);

    const activeD = volume.level > 0 ? segmentD(beginAngle, arcAngle) : '';
    dockedPlayer.volumeButton.querySelector('path.active_range').setAttribute('d', activeD);

    const inactiveD = volume.level < 1 ? segmentD(beginAngle + arcAngle, 270 - arcAngle) : '';
    dockedPlayer.volumeButton.querySelector('path.inactive_range').setAttribute('d', inactiveD);

    const percent = volume.level * 100;
    const percentFormatted = percent % 1 > 0.1 ? (Math.trunc(percent * 10) / 10) : Math.trunc(percent);
    dockedPlayer.volumeInput.setAttribute('aria-valuetext', `${PLAYER_JS_T.volume} ${percentFormatted}%`);
    dockedPlayer.volumeInput.value = volume.level;

    if (restoreLevel === null) {
        delete volume.restoreLevel;
    } else {
        volume.restoreLevel = restoreLevel;
    }
}

dockedPlayer.container.addEventListener('keydown', event => {
    if (event.target === dockedPlayer.volumeInput) return;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const seekTo = Math.max(0, activeTrack.audio.currentTime - 5);
        togglePlayback(activeTrack, seekTo);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        const seekTo = Math.min(activeTrack.duration - 1, activeTrack.audio.currentTime + 5);
        togglePlayback(activeTrack, seekTo);
    }
});

dockedPlayer.playbackButton.addEventListener('click', () => {
    togglePlayback(activeTrack ?? firstTrack);
});

// Not available on a track player
if (dockedPlayer.nextTrackButton) {
    dockedPlayer.nextTrackButton.addEventListener('click', () => {
        if (activeTrack?.nextTrack) {
            togglePlayback(activeTrack.nextTrack);
        }
    });
}

dockedPlayer.timeline.addEventListener('click', () => {
    const factor = (event.clientX - dockedPlayer.timeline.getBoundingClientRect().x) / dockedPlayer.timeline.getBoundingClientRect().width;
    const seekTo = factor * dockedPlayer.timelineInput.max;
    togglePlayback(activeTrack, seekTo);
    dockedPlayer.timeline.classList.add('focus_from_click');
    dockedPlayer.timelineInput.focus();
});

dockedPlayer.timelineInput.addEventListener('blur', () => {
    dockedPlayer.timeline.classList.remove('focus', 'focus_from_click');
});

dockedPlayer.timelineInput.addEventListener('focus', () => {
    dockedPlayer.timeline.classList.add('focus');
});

dockedPlayer.timelineInput.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        togglePlayback(activeTrack);
    }
});

volume.container.addEventListener('wheel', event => {
    event.preventDefault();

    volume.level += event.deltaY * -0.0001;

    if (volume.level > 1) {
        volume.level = 1;
    } else if (volume.level < 0) {
        volume.level = 0;
    }

    updateVolume();
});

dockedPlayer.volumeButton.addEventListener('click', () => {
    if (volume.level > 0) {
        const restoreLevel = volume.level;
        volume.level = 0;
        updateVolume(restoreLevel);
    } else {
        volume.level = volume.restoreLevel ?? 1;
        updateVolume();
    }
});

dockedPlayer.volumeInput.addEventListener('input', () => {
    volume.level = parseFloat(dockedPlayer.volumeInput.valueAsNumber);
    updateVolume();
});

// This was observed to jump between 0 and 1 without a single step in between,
// hence we disable the default behavior and handle it ourselves
dockedPlayer.volumeInput.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        volume.level -= 0.02;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        volume.level += 0.02;
    } else {
        return;
    }

    if (volume.level > 1) {
        volume.level = 1;
    } else if (volume.level < 0) {
        volume.level = 0;
    }

    updateVolume();

    event.preventDefault();
});

// This was observed to "scroll" between 0 and 1 without a single step in between,
// hence we disable the default behavior and let the event bubble up to our own handler
dockedPlayer.volumeInput.addEventListener('wheel', event => event.preventDefault());

listenButton.addEventListener('click', () => {
    togglePlayback(activeTrack ?? preselectedTrack ?? firstTrack);
});

const resizeObserver = new ResizeObserver(entries => {
    const minWidth = entries.reduce(
        (minWidth, entry) => Math.min(entry.contentRect.width, minWidth),
        Infinity
    );

    waveforms(minWidth);
});

let preselectedTrackOffset = null;
const searchParams = new URLSearchParams();
if (location.search.match(/^\?[0-9]+$/)) {
    preselectedTrackOffset = parseInt(location.search.substring(1)) - 1;
}

let previousTrack = null;
for (const container of document.querySelectorAll('.track')) {
    const artists = container.querySelector('.artists');
    const audio = container.querySelector('audio');
    const number = container.querySelector('.number');
    const playbackButton = container.querySelector('.track_playback');
    const playbackButtonIcon = container.querySelector('.track_playback .icon');
    const title = container.querySelector('.title');

    const duration = parseFloat(container.dataset.duration);

    const track = {
        artists,
        audio,
        container,
        duration,
        number,
        playbackButton,
        playbackButtonIcon,
        title
    };

    const waveformContainer = container.querySelector('.waveform');
    if (waveformContainer) {
        const input = waveformContainer.querySelector('.waveform input');
        const svg = waveformContainer.querySelector('.waveform svg');

        track.waveform = {
            container: waveformContainer,
            input,
            svg
        };
    }

    // Playback buttons start off with tabindex="-1" because if the visitor
    // has JavaScript disabled the element should not be interacted with at
    // all. When JavaScript is available we revert to making the button
    // reachable by keyboard.
    playbackButton.tabIndex = 0;

    if (firstTrack === null) {
        firstTrack = track;
        preselectedTrack = track;
    }

    if (preselectedTrackOffset !== null) {
        if (preselectedTrackOffset > 0) {
            preselectedTrackOffset -= 1;
        } else {
            preselectedTrack = track;
            preselectedTrackOffset = null;
        }
    }

    if (previousTrack !== null) {
        previousTrack.nextTrack = track;
    }

    previousTrack = track;

    audio.addEventListener('ended', event => {
        audio.currentTime = 0;
        container.classList.remove('active', 'playing');

        if (track.nextTrack) {
            togglePlayback(track.nextTrack);
        } else {
            activeTrack = null;
            document.body.classList.remove('player_active');
            dockedPlayer.status.setAttribute('aria-label', PLAYER_JS_T.playerClosed);
        }
    });

    audio.addEventListener('pause', event => {
        clearInterval(globalUpdatePlayHeadInterval);

        container.classList.remove('playing');
        dockedPlayer.playbackButton.replaceChildren(playIcon.content.cloneNode(true));
        listenButtonIcon.replaceChildren(playIcon.content.cloneNode(true));
        listenButtonLabel.textContent = PLAYER_JS_T.listen;
        track.playbackButtonIcon.replaceChildren(playIcon.content.cloneNode(true));

        if (track.onPause) {
            track.onPause();
            delete track.onPause;
        } else {
            updatePlayhead(track);
            announcePlayhead(track);
        }
    });

    audio.addEventListener('play', event => {
        container.classList.add('active', 'playing');
        dockedPlayer.playbackButton.replaceChildren(pauseIcon.content.cloneNode(true));
        listenButtonIcon.replaceChildren(pauseIcon.content.cloneNode(true));
        listenButtonLabel.textContent = PLAYER_JS_T.pause;
        track.playbackButtonIcon.replaceChildren(pauseIcon.content.cloneNode(true));

        globalUpdatePlayHeadInterval = setInterval(() => updatePlayhead(track), 1000 / 24);
        updatePlayhead(track);
        announcePlayhead(track);
    });

    audio.addEventListener('playing', event => {
        dockedPlayer.playbackButton.replaceChildren(pauseIcon.content.cloneNode(true));
        listenButtonIcon.replaceChildren(pauseIcon.content.cloneNode(true));
        listenButtonLabel.textContent = PLAYER_JS_T.pause;
        track.playbackButtonIcon.replaceChildren(pauseIcon.content.cloneNode(true));
    });

    audio.addEventListener('waiting', event => {
        // TODO: Eventually we could augment various screenreader labels here to
        //       indicate the loading state too
        dockedPlayer.playbackButton.replaceChildren(loadingIcon.content.cloneNode(true));
        listenButtonIcon.replaceChildren(loadingIcon.content.cloneNode(true));
        listenButtonLabel.textContent = PLAYER_JS_T.pause;
        track.playbackButtonIcon.replaceChildren(loadingIcon.content.cloneNode(true));
    });

    track.playbackButton.addEventListener('click', event => {
        event.preventDefault();
        togglePlayback(track);
    });

    container.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            const seekTo = Math.max(0, track.audio.currentTime - 5);
            togglePlayback(track, seekTo);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            const seekTo = Math.min(track.duration - 1, track.audio.currentTime + 5);
            togglePlayback(track, seekTo);
        }
    });

    if (track.waveform) {
        track.waveform.container.addEventListener('click', event => {
            const factor = (event.clientX - track.waveform.input.getBoundingClientRect().x) / track.waveform.input.getBoundingClientRect().width;
            const seekTo = factor * track.waveform.input.max
            togglePlayback(track, seekTo);
            track.waveform.input.classList.add('focus_from_click');
            track.waveform.input.focus();
        });

        track.waveform.container.addEventListener('mouseenter', event => {
            track.waveform.container.classList.add('seek');
        });

        track.waveform.container.addEventListener('mousemove', event => {
            const factor = (event.clientX - track.waveform.container.getBoundingClientRect().x) / track.waveform.container.getBoundingClientRect().width;
            // TODO: Pre-store the two querySelector results
            track.waveform.svg.querySelector('linearGradient.seek stop:nth-child(1)').setAttribute('offset', factor);
            track.waveform.svg.querySelector('linearGradient.seek stop:nth-child(2)').setAttribute('offset', factor + 0.0001);
        });

        track.waveform.container.addEventListener('mouseout', event => {
            track.waveform.container.classList.remove('seek');
        });

        track.waveform.input.addEventListener('blur', () => {
            track.waveform.input.classList.remove('focus_from_click');
        });

        track.waveform.input.addEventListener('focus', () => {
            announcePlayhead(track);
        });

        track.waveform.input.addEventListener('keydown', event => {
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                togglePlayback(track);
            }
        });

        const waveformParent = track.waveform.container.parentElement;
        resizeObserver.observe(waveformParent);
    }
}

preselectedTrack.container.classList.add('active');

function decode(string) {
    const peaks = [];

    for (let index = 0; index < string.length; index++) {
        const code = string.charCodeAt(index);
        if (code >= 65 && code <= 90) { // A-Z
            peaks.push(code - 65); // 0-25
        } else if (code >= 97 && code <= 122) { // a-z
            peaks.push(code - 71); // 26-51
        } else if (code > 48 && code < 57) { // 0-9
            peaks.push(code + 4); // 52-61
        } else if (code === 43) { // +
            peaks.push(62);
        } else if (code === 48) { // /
            peaks.push(63);
        }
    }

    return peaks;
}

const BREAKPOINT_REDUCED_WAVEFORM_REM = 20;
const TRACK_HEIGHT_EM = 1.5;
const WAVEFORM_PADDING_EM = 0.3;
const WAVEFORM_HEIGHT = TRACK_HEIGHT_EM - WAVEFORM_PADDING_EM * 2.0;

const WAVEFORM_WIDTH_PADDING_REM = 5;
const WAVEFORM_WIDTH_TOLERANCE_REM = 2.5;

const waveformRenderState = { widthRem: 0 };

function waveforms(minWidth) {
    const baseFontSizePx = parseFloat(
        window.getComputedStyle(document.documentElement)
              .getPropertyValue('font-size')
              .replace('px', '')
    );

    // We subtract -1 to avoid the waveform forcing its container to resize,
    // thereby causing recursive resize feedback.
    let maxWaveformWidthRem = (minWidth - WAVEFORM_WIDTH_PADDING_REM) / baseFontSizePx;
    let relativeWaveforms = maxWaveformWidthRem > BREAKPOINT_REDUCED_WAVEFORM_REM && !document.querySelector('[data-disable-relative-waveforms]');

    if (waveformRenderState.widthRem >= maxWaveformWidthRem - WAVEFORM_WIDTH_TOLERANCE_REM &&
        waveformRenderState.widthRem <= maxWaveformWidthRem + WAVEFORM_WIDTH_TOLERANCE_REM) return;

    const longestTrackDuration = parseFloat(document.querySelector('[data-longest-duration]').dataset.longestDuration);

    let trackNumber = 1;
    for (const waveform of document.querySelectorAll('.waveform')) {
        const input = waveform.querySelector('input');
        const svg = waveform.querySelector('svg[data-peaks]');
        const peaks = decode(svg.dataset.peaks).map(peak => peak / 63);

        const trackDuration = parseFloat(input.max);

        let waveformWidthRem = maxWaveformWidthRem;

        if (relativeWaveforms) {
            waveformWidthRem *= (trackDuration / longestTrackDuration);
        }

        // Render the waveform with n samples. Prefer 0.75 samples per pixel, but if there
        // are less peaks available than that, sample exactly at every peak.
        // 1 samples per pixel = More detail, but more jagged
        // 0.5 samples per pixel = Smoother, but more sampling artifacts
        // 0.75 looked like a good in-between (on my low-dpi test screen anyway)
        const preferredNumSamples = Math.round(0.75 * waveformWidthRem * baseFontSizePx);
        const numSamples = Math.min(preferredNumSamples, peaks.length);

        const prevY = WAVEFORM_PADDING_EM + (1 - peaks[0]) * WAVEFORM_HEIGHT;
        let d = `M 0,${prevY.toFixed(2)}`;

        let yChangeOccured = false;
        for (let sample = 1; sample < numSamples; sample += 1) {
            const factor = sample / (numSamples - 1);
            const floatIndex = factor * (peaks.length - 1);
            const previousIndex = Math.floor(floatIndex);
            const nextIndex = Math.ceil(floatIndex);

            let peak;
            if (previousIndex === nextIndex) {
                peak = peaks[previousIndex];
            } else {
                const interPeakBias = floatIndex - previousIndex;
                peak = peaks[previousIndex] * (1 - interPeakBias) + peaks[nextIndex] * interPeakBias;
            }

            const x = factor * waveformWidthRem;
            const y = WAVEFORM_PADDING_EM + (1 - peak) * WAVEFORM_HEIGHT;

            // If the y coordinate is always exactly the same on all points, the linear
            // gradient applied to the .playback path does not show up at all (firefox).
            // This only happens when the track is perfectly silent/same level all the
            // way through, which currently is the case when with the disable_waveforms option.
            // We counter this here by introducing minimal jitter on the y dimension.
            const yJitter = (y === prevY ? '1' : '');

            d += ` L ${x.toFixed(2)},${y.toFixed(2)}${yJitter}`;
        }

        const SVG_XMLNS = 'http://www.w3.org/2000/svg';

        if (!waveformRenderState.initialized) {
            svg.setAttribute('xmlns', SVG_XMLNS);
            svg.setAttribute('height', `${TRACK_HEIGHT_EM}em`);

            const defs = document.createElementNS(SVG_XMLNS, 'defs');

            const playbackGradient = document.createElementNS(SVG_XMLNS, 'linearGradient');
            playbackGradient.classList.add('playback');
            playbackGradient.id = `gradient_playback_${trackNumber}`;
            const playbackGradientStop1 = document.createElementNS(SVG_XMLNS, 'stop');
            playbackGradientStop1.setAttribute('offset', '0');
            playbackGradientStop1.setAttribute('stop-color', 'var(--fg-1)');
            const playbackGradientStop2 = document.createElementNS(SVG_XMLNS, 'stop');
            playbackGradientStop2.setAttribute('offset', '0.000001');
            playbackGradientStop2.setAttribute('stop-color', 'hsla(0, 0%, 0%, 0)');
            playbackGradient.append(playbackGradientStop1, playbackGradientStop2);

            const seekGradient = document.createElementNS(SVG_XMLNS, 'linearGradient');
            seekGradient.classList.add('seek');
            seekGradient.id = `gradient_seek_${trackNumber}`;
            const seekGradientStop1 = document.createElementNS(SVG_XMLNS, 'stop');
            seekGradientStop1.setAttribute('offset', '0');
            seekGradientStop1.setAttribute('stop-color', 'var(--fg-3)');
            const seekGradientStop2 = document.createElementNS(SVG_XMLNS, 'stop');
            seekGradientStop2.setAttribute('offset', '0.000001');
            seekGradientStop2.setAttribute('stop-color', 'hsla(0, 0%, 0%, 0)');
            seekGradient.append(seekGradientStop1, seekGradientStop2);

            defs.append(playbackGradient);
            defs.append(seekGradient);
            svg.prepend(defs);

            svg.querySelector('path.playback').setAttribute('stroke', `url(#gradient_playback_${trackNumber})`);
            svg.querySelector('path.seek').setAttribute('stroke', `url(#gradient_seek_${trackNumber})`);
        }

        svg.setAttribute('viewBox', `0 0 ${waveformWidthRem} 1.5`);
        svg.setAttribute('width', `${waveformWidthRem}em`);
        svg.querySelector('path.base').setAttribute('d', d);
        svg.querySelector('path.playback').setAttribute('d', d);
        svg.querySelector('path.seek').setAttribute('d', d);

        trackNumber++;
    }

    waveformRenderState.initialized = true;
    waveformRenderState.widthRem = maxWaveformWidthRem;
}
