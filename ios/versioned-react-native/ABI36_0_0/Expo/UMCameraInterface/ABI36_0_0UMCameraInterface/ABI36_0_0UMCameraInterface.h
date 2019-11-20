// Copyright 2018-present 650 Industries. All rights reserved.

#import <AVKit/AVKit.h>

@protocol ABI36_0_0UMCameraInterface

@property (nonatomic, strong) dispatch_queue_t sessionQueue;
@property (nonatomic, strong) AVCaptureSession *session;

@end