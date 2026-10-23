import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

export type ActionMotion = 'pop' | 'bounce' | 'pulse' | 'shake' | 'launch' | 'float' | 'heartbeat' | 'wobble';

const springBack = (value: Animated.Value) =>
  Animated.spring(value, { toValue: 0, damping: 9, stiffness: 260, mass: 0.7, useNativeDriver: true });

/**
 * Press-down feedback plus a one-shot signature motion for each action.
 * Core Animated only, so this is deterministic in the Jest renderer and does
 * not require a Reanimated worklet on the UI thread.
 */
export function usePressMotion(motion: ActionMotion = 'pop', activeScale = 0.95) {
  const [scale] = useState(() => new Animated.Value(1));
  const [translateX] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(0));
  const [rotate] = useState(() => new Animated.Value(0));
  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => running.current?.stop(), []);

  const pressIn = useCallback(() => {
    running.current?.stop();
    Animated.spring(scale, { toValue: activeScale, damping: 18, stiffness: 500, useNativeDriver: true }).start();
  }, [activeScale, scale]);

  const pressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, damping: 14, stiffness: 420, useNativeDriver: true }).start();
  }, [scale]);

  const play = useCallback(() => {
    running.current?.stop();
    translateX.setValue(0);
    translateY.setValue(0);
    rotate.setValue(0);

    let animation: Animated.CompositeAnimation;
    switch (motion) {
      case 'bounce':
        animation = Animated.parallel([
          Animated.sequence([
            Animated.timing(translateY, { toValue: -5, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            springBack(translateY),
          ]),
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.045, duration: 90, useNativeDriver: true }),
            Animated.spring(scale, { toValue: 1, damping: 8, stiffness: 300, useNativeDriver: true }),
          ]),
        ]);
        break;
      case 'pulse':
        animation = Animated.sequence([
          Animated.timing(scale, { toValue: 1.07, duration: 100, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 110, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.035, duration: 80, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]);
        break;
      case 'shake':
        animation = Animated.sequence([
          Animated.timing(translateX, { toValue: -4, duration: 40, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: 4, duration: 45, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: -3, duration: 40, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: 2, duration: 35, useNativeDriver: true }),
          Animated.timing(translateX, { toValue: 0, duration: 35, useNativeDriver: true }),
        ]);
        break;
      case 'launch':
        animation = Animated.parallel([
          Animated.sequence([
            Animated.timing(translateY, { toValue: -7, duration: 100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            springBack(translateY),
          ]),
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.06, duration: 100, useNativeDriver: true }),
            Animated.spring(scale, { toValue: 1, damping: 8, stiffness: 300, useNativeDriver: true }),
          ]),
        ]);
        break;
      case 'float':
        animation = Animated.parallel([
          Animated.sequence([
            Animated.timing(translateY, { toValue: -3, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            springBack(translateY),
          ]),
          Animated.sequence([
            Animated.timing(rotate, { toValue: 0.18, duration: 140, useNativeDriver: true }),
            Animated.spring(rotate, { toValue: 0, damping: 9, stiffness: 220, useNativeDriver: true }),
          ]),
        ]);
        break;
      case 'heartbeat':
        animation = Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 90, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.96, duration: 90, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.07, duration: 80, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, damping: 8, stiffness: 320, useNativeDriver: true }),
        ]);
        break;
      case 'wobble':
        animation = Animated.sequence([
          Animated.timing(rotate, { toValue: 1, duration: 55, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: -1, duration: 70, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 0.45, duration: 55, useNativeDriver: true }),
          Animated.spring(rotate, { toValue: 0, damping: 9, stiffness: 250, useNativeDriver: true }),
        ]);
        break;
      case 'pop':
      default:
        animation = Animated.sequence([
          Animated.timing(scale, { toValue: 1.1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, damping: 8, stiffness: 320, useNativeDriver: true }),
        ]);
        break;
    }

    running.current = animation;
    animation.start();
  }, [motion, rotate, scale, translateX, translateY]);

  return {
    pressMotionStyle: {
      transform: [
        { translateX },
        { translateY },
        { scale },
        { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) },
      ],
    } as const,
    pressIn,
    pressOut,
    play,
  };
}
