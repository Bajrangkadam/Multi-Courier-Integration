import { CourierRegistry } from "./registry";
import { MockCourierAdapter } from "./mock/MockCourierAdapter";
import { UrbaneBoltAdapter } from "./urbanebolt/UrbaneBoltAdapter";

export const courierRegistry = new CourierRegistry();
courierRegistry.register(new MockCourierAdapter());
courierRegistry.register(new UrbaneBoltAdapter());
