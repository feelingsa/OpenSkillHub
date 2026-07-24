import { gsap } from "/vendor/gsap/index.js";

export { gsap };

function immediate(target, vars = {}) {
  const { autoAlpha, onComplete, x, y, z, xPercent, yPercent, scale, rotation, rotationX, ...styleVars } = vars;
  if (target instanceof Element) {
    if (autoAlpha !== undefined) {
      target.style.opacity = String(autoAlpha);
      target.style.visibility = Number(autoAlpha) === 0 ? "hidden" : "inherit";
    }
    const transforms = [];
    if (xPercent !== undefined) transforms.push(`translateX(${xPercent}%)`);
    if (yPercent !== undefined) transforms.push(`translateY(${yPercent}%)`);
    if (x !== undefined) transforms.push(`translateX(${x}px)`);
    if (y !== undefined) transforms.push(`translateY(${y}px)`);
    if (z !== undefined) transforms.push(`translateZ(${z}px)`);
    if (rotation !== undefined) transforms.push(`rotate(${rotation}deg)`);
    if (rotationX !== undefined) transforms.push(`rotateX(${rotationX}deg)`);
    if (scale !== undefined) transforms.push(`scale(${scale})`);
    if (transforms.length) target.style.transform = transforms.join(" ");
    for (const [name, value] of Object.entries(styleVars)) {
      if (!["duration", "ease", "overwrite", "stagger"].includes(name)) target.style.setProperty(name, String(value));
    }
  }
  if (typeof onComplete === "function") queueMicrotask(onComplete);
  return { kill() {} };
}

export function createMotionScope(root) {
  if (!root) {
    return {
      enter: immediate,
      exit: immediate,
      stagger: immediate,
      status: immediate,
      set: immediate,
      to: immediate,
      revert() {},
    };
  }

  const engine = gsap;
  const context = engine.context(() => {}, root);
  const media = engine.matchMedia();
  const animations = new Set();
  let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  media.add({ reduceMotion: "(prefers-reduced-motion: reduce)" }, (mediaContext) => {
    reduceMotion = Boolean(mediaContext.conditions?.reduceMotion);
  });

  function track(factory, target, reducedVars) {
    if (reduceMotion) return immediate(target, reducedVars);
    let animation;
    context.add(() => {
      animation = factory();
      animations.add(animation);
    });
    return animation;
  }

  return {
    enter(target, vars = {}) {
      return track(() => engine.fromTo(target, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: "power2.out", ...vars }), target, { opacity: "1", visibility: "inherit" });
    },
    exit(target, vars = {}) {
      return track(() => engine.to(target, { autoAlpha: 0, duration: 0.16, ease: "power1.in", ...vars }), target, { opacity: "0", visibility: "hidden" });
    },
    stagger(targets, vars = {}) {
      return track(() => engine.fromTo(targets, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: "power2.out", stagger: 0.04, ...vars }), root, {});
    },
    status(target, vars = {}) {
      return track(() => engine.to(target, { "--status-pulse": 1, duration: 0.18, ease: "power1.out", ...vars }), target, {});
    },
    set(target, vars = {}) {
      return reduceMotion ? immediate(target, vars) : engine.set(target, vars);
    },
    to(target, vars = {}) {
      return track(() => engine.to(target, vars), target, vars);
    },
    revert() {
      for (const animation of animations) animation.kill();
      animations.clear();
      media.revert();
      context.revert();
    },
  };
}
