const sampleTourUrl = '../shared/sample-tour.json';
const fallbackProject = {
  settings: {
    mouseViewMode: 'drag',
    autorotateEnabled: false,
    fullscreenButton: true,
    gyroEnabled: false,
    vrEnabled: true
  },
  scenes: [
    {
      id: 'scene-entrance',
      name: 'Entrance',
      levels: [{ tileSize: 256, size: 256, fallbackOnly: true }],
      faceSize: 2048,
      initialViewParameters: { yaw: 0, pitch: 0, fov: 1.4 },
      hotspots: [
        {
          id: 'hs-altar',
          yaw: 0,
          pitch: 0,
          iconId: 'info',
          title: 'Main Altar',
          contentBlocks: [{ type: 'text', value: 'Sample content.' }]
        }
      ]
    }
  ],
  assets: { icons: [], media: [] }
};

const panoElement = document.getElementById('pano');
const panoLeft = document.getElementById('pano-left');
const panoRight = document.getElementById('pano-right');
const sceneList = document.getElementById('scene-list');
const modal = document.getElementById('hotspot-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const btnGyro = document.getElementById('btn-gyro');
const btnReset = document.getElementById('btn-reset-orientation');
const btnVr = document.getElementById('btn-vr');

let viewer = null;
let activeViewer = null;
let vrViewers = null;
let scenes = [];
let currentScene = null;
let gyroEnabled = false;
let gyroMethod = null;
let gyroFallbackListener = null;
let gyroFallbackZeroAlpha = null;
let projectData = null;

function openModal(hotspot) {
  modalTitle.textContent = hotspot.title || 'Hotspot';
  modalBody.innerHTML = '';

  (hotspot.contentBlocks || []).forEach((block) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'block';

    const heading = document.createElement('h4');
    heading.textContent = block.type;
    wrapper.appendChild(heading);

    if (block.type === 'text') {
      const p = document.createElement('p');
      p.textContent = block.value || '';
      wrapper.appendChild(p);
    }

    if (block.type === 'image' && block.assetPath) {
      const img = document.createElement('img');
      img.src = block.assetPath;
      img.alt = hotspot.title || 'Hotspot image';
      wrapper.appendChild(img);
    }

    if (block.type === 'video') {
      if (block.url) {
        const iframe = document.createElement('iframe');
        iframe.src = block.url;
        iframe.width = '100%';
        iframe.height = '360';
        iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        iframe.style.border = '0';
        wrapper.appendChild(iframe);
      } else if (block.assetPath) {
        const video = document.createElement('video');
        video.controls = true;
        video.src = block.assetPath;
        wrapper.appendChild(video);
      }
    }

    if (block.type === 'audio' && block.assetPath) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = block.assetPath;
      wrapper.appendChild(audio);
    }

    if (block.type === 'link') {
      const link = document.createElement('a');
      link.href = block.url || '#';
      link.textContent = block.label || 'Open link';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      wrapper.appendChild(link);
    }

    modalBody.appendChild(wrapper);
  });

  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

function resolveAssetPaths(project) {
  const mediaMap = new Map(
    (project.assets?.media || []).map((m) => [m.id, m.dataUrl || m.path || ''])
  );
  const iconMap = new Map(
    (project.assets?.icons || []).map((i) => [i.id, i.dataUrl || i.path || ''])
  );

  project.scenes.forEach((scene) => {
    scene.hotspots.forEach((hotspot) => {
      hotspot.iconPath = iconMap.get(hotspot.iconId) || '';
      hotspot.contentBlocks.forEach((block) => {
        if (block.assetId) {
          block.assetPath = mediaMap.get(block.assetId) || '';
        }
      });
    });
  });
}

function buildViewer(project) {
  if (!window.Marzipano) {
    console.warn('Marzipano not available.');
    return;
  }

  projectData = project;
  viewer = new Marzipano.Viewer(panoElement, {
    controls: {
      mouseViewMode: project.settings?.mouseViewMode || 'drag'
    }
  });
  activeViewer = viewer;

  scenes = project.scenes.map((sceneData) => {
    const runtime = buildSceneRuntime(sceneData);
    if (!runtime) return null;
    const source = runtime.source;
    const geometry = runtime.geometry;
    const limiter = runtime.limiter;
    const view = new Marzipano.RectilinearView(sceneData.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 }, limiter);
    const scene = viewer.createScene({ source, geometry, view, pinFirstLevel: true });
    const hotspotElements = [];

    (sceneData.hotspots || []).forEach((hotspot) => {
      const element = createHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
      hotspotElements.push(element);
    });

    view.addEventListener('change', () => {
      applyHotspotScale({ view, hotspotElements });
    });

    return { data: sceneData, scene, view, hotspotElements };
  }).filter(Boolean);

  renderSceneList();
  if (scenes[0]) {
    switchScene(scenes[0]);
  }
}

function buildVrViewers(project) {
  if (vrViewers || !window.Marzipano) return;

  const leftViewer = new Marzipano.Viewer(panoLeft, {
    controls: {
      mouseViewMode: project.settings?.mouseViewMode || 'drag'
    }
  });
  const rightViewer = new Marzipano.Viewer(panoRight, {
    controls: {
      mouseViewMode: project.settings?.mouseViewMode || 'drag'
    }
  });

  const leftScenes = project.scenes.map((sceneData) => {
    const runtime = buildSceneRuntime(sceneData);
    if (!runtime) return null;
    const source = runtime.source;
    const geometry = runtime.geometry;
    const limiter = runtime.limiter;
    const view = new Marzipano.RectilinearView(sceneData.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 }, limiter);
    const scene = leftViewer.createScene({ source, geometry, view, pinFirstLevel: true });
    return { data: sceneData, scene, view };
  }).filter(Boolean);

  const rightScenes = project.scenes.map((sceneData) => {
    const runtime = buildSceneRuntime(sceneData);
    if (!runtime) return null;
    const source = runtime.source;
    const geometry = runtime.geometry;
    const limiter = runtime.limiter;
    const view = new Marzipano.RectilinearView(sceneData.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 }, limiter);
    const scene = rightViewer.createScene({ source, geometry, view, pinFirstLevel: true });
    return { data: sceneData, scene, view };
  }).filter(Boolean);

  vrViewers = { leftViewer, rightViewer, leftScenes, rightScenes };

  leftScenes.forEach((scene, index) => {
    scene.view.addEventListener('change', () => {
      const params = scene.view.parameters();
      rightScenes[index].view.setParameters(params);
    });
  });
}

function buildSceneRuntime(sceneData) {
  if (sceneData?.sourceImage?.dataUrl) {
    const width = sceneData.sourceImage.width || sceneData.faceSize || 4096;
    return {
      source: Marzipano.ImageUrlSource.fromString(sceneData.sourceImage.dataUrl),
      geometry: new Marzipano.EquirectGeometry([{ width }]),
      limiter: Marzipano.RectilinearView.limit.traditional(width, Math.PI, Math.PI)
    };
  }

  const levels = (sceneData.levels || []).filter((level) => level.size && level.tileSize);
  const hasSelectable = levels.some((level) => !level.fallbackOnly);
  if (!levels.length || !hasSelectable) {
    return null;
  }

  const tilesPath = sceneData.tilesPath || `tiles/${sceneData.id}`;
  const previewPath = sceneData.previewPath || `${tilesPath}/preview.jpg`;
  return {
    source: Marzipano.ImageUrlSource.fromString(
      `${tilesPath}/{z}/{f}/{y}/{x}.jpg`,
      { cubeMapPreviewUrl: previewPath }
    ),
    geometry: new Marzipano.CubeGeometry(levels),
    limiter: Marzipano.RectilinearView.limit.traditional(sceneData.faceSize || 2048, Math.PI, Math.PI)
  };
}

function createHotspotElement(hotspot) {
  const wrapper = document.createElement('div');
  wrapper.className = 'hotspot';
  wrapper.setAttribute('aria-label', hotspot.title || 'Hotspot');

  if (hotspot.iconPath) {
    const img = document.createElement('img');
    img.src = hotspot.iconPath;
    img.alt = '';
    img.className = 'hotspot-icon';
    img.addEventListener('error', () => {
      img.remove();
      wrapper.classList.add('hotspot-default');
      wrapper.textContent = 'i';
    });
    wrapper.appendChild(img);
  } else {
    wrapper.classList.add('hotspot-default');
    wrapper.textContent = 'i';
  }

  wrapper.addEventListener('click', () => openModal(hotspot));

  return wrapper;
}

function renderSceneList() {
  sceneList.innerHTML = '';
  scenes.forEach((scene) => {
    const button = document.createElement('button');
    button.textContent = scene.data.name;
    button.addEventListener('click', () => switchScene(scene));
    sceneList.appendChild(button);
  });
}

function switchScene(scene) {
  currentScene = scene;
  scene.view.setParameters(scene.data.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 });
  scene.scene.switchTo();
  applyHotspotScale(scene);

  if (vrViewers) {
    const leftScene = vrViewers.leftScenes.find((item) => item.data.id === scene.data.id);
    const rightScene = vrViewers.rightScenes.find((item) => item.data.id === scene.data.id);
    if (leftScene && rightScene) {
      leftScene.view.setParameters(scene.data.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 });
      rightScene.view.setParameters(scene.data.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 });
      leftScene.scene.switchTo();
      rightScene.scene.switchTo();
    }
  }
}

function applyHotspotScale(scene) {
  if (!scene?.hotspotElements?.length) return;
  const fov = scene.view.fov ? scene.view.fov() : (scene.view.parameters?.().fov || 1.4);
  const scale = Math.max(0.5, Math.min(0.95, 1.0 / Math.max(fov, 0.1)));
  scene.hotspotElements.forEach((el) => {
    el.style.setProperty('--hotspot-scale', String(scale));
  });
}

async function requestMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const result = await DeviceOrientationEvent.requestPermission();
    return result === 'granted';
  }
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    const result = await DeviceMotionEvent.requestPermission();
    return result === 'granted';
  }
  return true;
}

async function toggleGyro() {
  if (!activeViewer || !currentScene) {
    return;
  }

  const canUseMarzipanoGyro = Boolean(window.Marzipano?.DeviceOrientationControlMethod);
  const canUseDeviceOrientation = typeof window.DeviceOrientationEvent !== 'undefined';

  if (!canUseMarzipanoGyro && !canUseDeviceOrientation) {
    alert('Gyro is not available in this browser.');
    return;
  }

  if (!gyroEnabled) {
    const granted = await requestMotionPermission();
    if (!granted) {
      alert('Motion access denied.');
      return;
    }

    if (canUseMarzipanoGyro) {
      gyroMethod = gyroMethod || new Marzipano.DeviceOrientationControlMethod();
      const controls = activeViewer.controls();

      if (controls.enableMethod && controls.disableMethod) {
        if (!gyroEnabled) {
          controls.registerMethod('gyro', gyroMethod, false);
          controls.enableMethod('gyro');
        }
      } else {
        controls.registerMethod('gyro', gyroMethod, true);
      }
    } else {
      gyroFallbackZeroAlpha = null;
      gyroFallbackListener = (event) => {
        if (event.alpha == null || event.beta == null) return;
        if (gyroFallbackZeroAlpha == null) {
          gyroFallbackZeroAlpha = event.alpha;
        }
        const yawDeg = event.alpha - gyroFallbackZeroAlpha;
        const pitchDeg = event.beta;
        const yaw = (yawDeg * Math.PI) / 180;
        const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, (-pitchDeg * Math.PI) / 180));
        currentScene.view.setParameters({ yaw, pitch });
      };
      window.addEventListener('deviceorientation', gyroFallbackListener, true);
    }

    gyroEnabled = true;
    btnGyro.textContent = 'Disable Gyro';
  } else {
    if (gyroFallbackListener) {
      window.removeEventListener('deviceorientation', gyroFallbackListener, true);
      gyroFallbackListener = null;
      gyroFallbackZeroAlpha = null;
    } else {
      const controls = activeViewer.controls();
      if (controls.disableMethod) {
        controls.disableMethod('gyro');
      }
    }
    gyroEnabled = false;
    btnGyro.textContent = 'Enable Gyro';
  }
}

function resetOrientation() {
  if (!currentScene) return;
  currentScene.view.setParameters(currentScene.data.initialViewParameters || { yaw: 0, pitch: 0, fov: 1.4 });
}

function enterVr() {
  if (window.screenfull?.isEnabled) {
    screenfull.toggle();
    document.body.classList.toggle('vr-mode');
  }

  if (!vrViewers && projectData) {
    buildVrViewers(projectData);
  }

  if (vrViewers && currentScene) {
    const leftScene = vrViewers.leftScenes.find((item) => item.data.id === currentScene.data.id);
    const rightScene = vrViewers.rightScenes.find((item) => item.data.id === currentScene.data.id);
    if (leftScene && rightScene) {
      leftScene.view.setParameters(currentScene.view.parameters());
      rightScene.view.setParameters(currentScene.view.parameters());
      leftScene.scene.switchTo();
      rightScene.scene.switchTo();
      activeViewer = vrViewers.leftViewer;
    }
  } else {
    activeViewer = viewer;
  }

  if (!navigator.xr) {
    openModal({
      title: 'VR Mode',
      contentBlocks: [
        { type: 'text', value: 'WebXR is not available in this browser. Cardboard mode uses fullscreen only.' }
      ]
    });
    return;
  }

  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) {
      openModal({
        title: 'VR Mode',
        contentBlocks: [
          { type: 'text', value: 'Immersive VR is not supported on this device.' }
        ]
      });
      return;
    }

    navigator.xr.requestSession('immersive-vr').then((session) => {
      openModal({
        title: 'VR Mode',
        contentBlocks: [
          {
            type: 'text',
            value:
              'WebXR session started. Stereoscopic rendering integration is in progress.'
          }
        ]
      });

      session.addEventListener('end', () => {
        // session ended
      });

      // End immediately to avoid keeping a blank XR session active for now.
      session.end();
    });
  });
}

fetch(sampleTourUrl)
  .then((res) => res.json())
  .then((project) => {
    resolveAssetPaths(project);
    buildViewer(project);
  })
  .catch(() => {
    resolveAssetPaths(fallbackProject);
    buildViewer(fallbackProject);
  });

btnGyro.addEventListener('click', toggleGyro);
btnReset.addEventListener('click', resetOrientation);
btnVr.addEventListener('click', enterVr);

document.getElementById('btn-close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});
