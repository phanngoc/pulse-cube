/** One world unit is one cube. Everything below is expressed in cubes and
 *  seconds so the level files read like graph paper. */
export const CUBE = 1;

/** Constant forward speed - the player never controls it. */
export const SPEED = 10.4;
export const GRAVITY = 127;
/** Chosen together with GRAVITY so a jump clears 2.6 cubes of height and about
 *  4.2 cubes of ground: the spacing every level is designed against. */
export const JUMP_V = 25.7;
export const PAD_V = 33.5;

/** A press up to this long before landing still fires on touchdown, and the
 *  cube still jumps this long after leaving a ledge. Without both, a
 *  one-button game feels broken rather than hard. */
export const JUMP_BUFFER = 0.12;
export const COYOTE = 0.08;

/** Below this the cube has fallen into a pit and is gone. */
export const PIT_Y = -6;

/** Target height in cubes. The camera keeps the SCALE uniform on both axes -
 *  a cube that is not square is not a cube - so this is only the height we get
 *  when the width lands inside the clamp; a tall phone trades it for more sky. */
export const VIEW_H = 13;
export const MIN_VIEW_W = 12;
export const MAX_VIEW_W = 34;
/** Cubes of ground kept visible below the floor line, in world units, so the
 *  horizon sits in the same place on every screen shape. */
export const FLOOR_MARGIN = 2.6;
/** The cube sits this fraction across the screen so you can see what is coming. */
export const CAMERA_ANCHOR = 0.3;
