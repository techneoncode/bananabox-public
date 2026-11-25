declare const __BANANABOX_IDE__: string | undefined;

/** True in the CLion build, which defines the constant; the VS Code build leaves it undefined. */
export const isClion = typeof __BANANABOX_IDE__ === 'string' && __BANANABOX_IDE__ === 'CLion';
