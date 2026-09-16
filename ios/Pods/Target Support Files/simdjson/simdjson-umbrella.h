#ifdef __OBJC__
#import <UIKit/UIKit.h>
#else
#ifndef FOUNDATION_EXPORT
#if defined(__cplusplus)
#define FOUNDATION_EXPORT extern "C"
#else
#define FOUNDATION_EXPORT extern
#endif
#endif
#endif

#include "../../../../node_modules/.pnpm/@nozbe+simdjson@3.9.4/node_modules/@nozbe/simdjson/src/simdjson.h"

FOUNDATION_EXPORT double simdjsonVersionNumber;
FOUNDATION_EXPORT const unsigned char simdjsonVersionString[];
