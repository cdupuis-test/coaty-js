﻿/*! Copyright (c) 2018 Siemens AG. Licensed under the MIT License. */

/**
 * Test suite for framework communication.
 */

import {
    ChannelEvent,
    CommunicationManager,
    CommunicationState,
    DiscoverEvent,
    DiscoverEventData,
    RemoteCallErrorCode,
    RemoteCallErrorMessage,
    UpdateEvent,
} from "../../com";
import { CommunicationEventType } from "../../com/communication-event";
import { CommunicationTopic } from "../../com/communication-topic";
import { ContextFilter, CoreTypes, DisplayType, filterOp, User } from "../../model";
import { Components, Configuration, Container } from "../../runtime";

import * as mocks from "./communication.mocks";
import { delayAction, Spy, UUID_REGEX } from "./utils";

describe("Communication", () => {

    describe("Communication Topic", () => {

        const version = CommunicationManager.PROTOCOL_VERSION;
        const isReadable = true;
        const associatedUserId = "0ea293e5-f8be-4a5d-886b-0e231e8234b2";
        const associatedUser: User = {
            name: "User+/#HHO\u0000",
            objectType: CoreTypes.OBJECT_TYPE_USER,
            coreType: "User",
            objectId: associatedUserId,
            names: {
                givenName: "Hubertus",
                familyName: "Hohl",
            },
        };
        const senderId = "3d34eb53-2536-4134-b0cd-8c406b94bb80";
        const topic = CommunicationTopic.createByLevels(
            associatedUser,
            senderId,
            CommunicationEventType.Advertise,
            "CoatyObject",
            "7d6dd7e6-4f3d-4cdf-92f5-3d926a55663d",
            version,
            isReadable);
        const topicNoUser = CommunicationTopic.createByLevels(
            undefined,
            senderId,
            CommunicationEventType.Advertise,
            "CoatyObject",
            "7d6dd7e6-4f3d-4cdf-92f5-3d926a55663d",
            version,
            isReadable);

        it("throws on invalid topic structure format", () => {
            expect(() => CommunicationTopic.createByName(
                topicNoUser.getTopicName().replace("-", ""))).toThrow();
        });

        it("has correct level structure for no associated user", () => {
            expect(topicNoUser.associatedUserId).toBe(undefined);
            expect(topicNoUser.sourceObjectId).toBe(senderId);
            expect(topicNoUser.eventType).toBe(CommunicationEventType.Advertise);
            expect(topicNoUser.eventTypeName).toBe("Advertise:CoatyObject");
            expect(topicNoUser.messageToken).toBe(`${senderId}_1`);
            expect(topicNoUser.version).toBe(version);

            const tpc = CommunicationTopic.createByName(topicNoUser.getTopicName());
            expect(tpc.associatedUserId).toBe(undefined);
            expect(tpc.sourceObjectId).toBe(senderId);
            expect(tpc.eventType).toBe(CommunicationEventType.Advertise);
            expect(tpc.eventTypeName).toBe("Advertise:CoatyObject");
            expect(tpc.messageToken).toBe(`${senderId}_1`);
            expect(tpc.version).toBe(version);
        });

        it("has correct level structure for associated user", () => {
            expect(topic.associatedUserId).toBe("User___HHO_" + "_" + associatedUserId);
            expect(topic.sourceObjectId).toBe(senderId);
            expect(topic.eventType).toBe(CommunicationEventType.Advertise);
            expect(topic.eventTypeName).toBe("Advertise:CoatyObject");
            expect(topic.messageToken).toBe(`${senderId}_0`);
            expect(topic.version).toBe(version);

            const tpc = CommunicationTopic.createByName(topic.getTopicName());
            expect(tpc.associatedUserId).toBe("User___HHO_" + "_" + associatedUserId);
            expect(tpc.sourceObjectId).toBe(senderId);
            expect(tpc.eventType).toBe(CommunicationEventType.Advertise);
            expect(tpc.eventTypeName).toBe("Advertise:CoatyObject");
            expect(tpc.messageToken).toBe(`${senderId}_0`);
            expect(tpc.version).toBe(version);
        });

        it("has correct filter structure for associated user", () => {
            const eventName = CommunicationTopic.getEventTypeName(CommunicationEventType.Discover);
            const topicFilter = CommunicationTopic.getTopicFilter(version, eventName, associatedUser, undefined);
            const [start, protocolName, v, evt, usr, sender, token, end] = topicFilter.split("/");
            expect(start).toBe("");
            expect(protocolName).toBe(CommunicationTopic.PROTOCOL_NAME);
            expect(usr).toBe(associatedUser.objectId);
            expect(sender).toBe("+");
            expect(evt).toBe(eventName);
            expect(token).toBe("+");
            expect(v).toBe(version.toString());
            expect(end).toBe("");
        });

        it("has correct filter structure for any user", () => {
            const eventName = CommunicationTopic.getEventTypeName(CommunicationEventType.Advertise, "CoatyObject");
            const topicFilter = CommunicationTopic.getTopicFilter(version, eventName, undefined, undefined);
            const [start, protocolName, v, evt, usr, sender, token, end] = topicFilter.split("/");
            expect(start).toBe("");
            expect(protocolName).toBe(CommunicationTopic.PROTOCOL_NAME);
            expect(usr).toBe("+");
            expect(sender).toBe("+");
            expect(evt).toBe(eventName);
            expect(token).toBe("+");
            expect(v).toBe(version.toString());
            expect(end).toBe("");
        });

        it("has correct filter structure for response subscription", () => {
            const messageToken = "62879980-94c9-47a9-92d5-61c9e86f7742";
            const eventName = CommunicationTopic.getEventTypeName(CommunicationEventType.Resolve, "CoatyObject");
            const topicFilter = CommunicationTopic.getTopicFilter(version, eventName, undefined, messageToken);
            const [start, protocolName, v, evt, usr, sender, token, end] = topicFilter.split("/");
            expect(start).toBe("");
            expect(protocolName).toBe(CommunicationTopic.PROTOCOL_NAME);
            expect(usr).toBe("+");
            expect(sender).toBe("+");
            expect(evt).toBe(eventName);
            expect(token).toBe(messageToken);
            expect(v).toBe(version.toString());
            expect(end).toBe("");
        });

    });

    describe("Event Patterns", () => {

        const TEST_TIMEOUT = 10000;
        const USE_READABLE_TOPICS = true;

        const components1: Components = {
            controllers: {
                MockDeviceController: mocks.MockDeviceController,
                MockOperationsCallController: mocks.MockOperationsCallController,
            },
        };

        const configuration1: Configuration = {
            common: {
                associatedUser: {
                    name: "Fred",
                    objectType: CoreTypes.OBJECT_TYPE_USER,
                    coreType: "User",
                    objectId: "f608cdb1-3350-4c62-8feb-4589f26f2efe",
                    names: {
                        givenName: "Fred",
                        familyName: "Feuerstein",
                    },
                },
                associatedDevice: {
                    name: "Fred's Device",
                    coreType: "Device",
                    objectType: CoreTypes.OBJECT_TYPE_DEVICE,
                    objectId: "db02ef91-7024-4cbb-9182-61fa57a8f0eb",
                    displayType: DisplayType.Watch,
                },
            },
            communication: {
                brokerUrl: "mqtt://localhost:1898",
                identity: { name: "Agent1" },
                shouldAutoStart: true,
                useReadableTopics: USE_READABLE_TOPICS,
            },
            controllers: {
                MockDeviceController: {
                    identity: { name: "MockDeviceController1" },
                    shouldAdvertiseIdentity: true,
                },
                MockOperationsCallController: {
                    identity: { name: "MockOperationsCallController1" },
                },
            },
        };

        const components2: Components = {
            controllers: {
                MockObjectController: mocks.MockObjectController,
                MockOperationsExecutionController: mocks.MockOperationsExecutionController,
            },
        };

        const responseDelay = 1000;

        const configuration2: Configuration = {
            common: {
            },
            communication: {
                brokerUrl: "mqtt://localhost:1898",
                shouldAutoStart: true,
                useReadableTopics: USE_READABLE_TOPICS,
            },
            controllers: {
                MockObjectController: {
                    identity: { name: "MockObjectController1" },
                    shouldAdvertiseIdentity: true,
                    responseDelay: responseDelay,
                },
                MockOperationsExecutionController: {
                    identity: { name: "MockOperationsExecutionController1" },
                },
            },
        };

        const components3: Components = {
            controllers: {
                MockObjectController: mocks.MockObjectController,
            },
        };

        const configuration3: Configuration = {
            common: {
            },
            communication: {
                brokerUrl: "mqtt://localhost:1898",
                shouldAutoStart: true,
                useReadableTopics: USE_READABLE_TOPICS,
            },
            controllers: {
                MockObjectController: {
                    identity: { name: "MockObjectController2" },
                    shouldAdvertiseIdentity: true,
                    responseDelay: responseDelay,
                },
            },
        };

        let container1: Container;
        let container2: Container;
        let container3: Container;

        beforeAll(done => {
            Spy.reset();

            container2 = Container.resolve(components2, configuration2);
            container3 = Container.resolve(components3, configuration3);

            delayAction(1000, done, () => {
                // Delay publishing to give MockObjectControllers time to subscribe
                container1 = Container.resolve(components1, configuration1);
            });
        });

        afterAll(
            done => {
                container1.shutdown();
                container2.shutdown();
                container3.shutdown();

                Spy.reset();

                delayAction(1000, done, () => {
                    // give Mosca time to log output messages
                });
            },
            TEST_TIMEOUT);

        it("throws on resubscription for response events", (done) => {
            let isResubOkay = false;
            let isResubError = false;
            const obs = container2.getCommunicationManager()
                .publishUpdate(UpdateEvent.withPartial(
                    container2.getController("MockObjectController").identity,
                    "7d6dd7e6-4f3d-4cdf-92f5-3d926a55663d", { foo: 1 }));
            const subscription = obs.subscribe(event => event);
            subscription.unsubscribe();
            obs.subscribe(event => { isResubOkay = true; },
                error => { isResubError = true; });

            delayAction(responseDelay, done, () => {
                expect(isResubOkay).toBeFalsy();
                expect(isResubError).toBeTruthy();
            });
        }, TEST_TIMEOUT);

        it("not throws on valid Discover event data", () => {
            expect(() => container2.getCommunicationManager()
                // Note: this Discover request event will never be published because there is 
                // no subscription on the response observable
                .publishDiscover(DiscoverEvent.withObjectTypes(
                    container2.getController("MockObjectController").identity,
                    ["coaty.test.MockObject"])))
                .not.toThrow();
        });

        it("throws on invalid Discover event data", () => {
            expect(() => container2.getCommunicationManager()
                .publishDiscover(new DiscoverEvent(
                    container2.getController("MockObjectController").identity,
                    new DiscoverEventData(
                        undefined,
                        "f608cdb1-3350-4c62-8feb-4589f26f2efe",
                        undefined,
                        ["User"]))))
                .toThrow();
        });

        it("Discover event yields Resolve events", (done) => {
            delayAction(responseDelay + 2000, done, () => {

                let associatedUserId = configuration1.common.associatedUser.name +
                    "_" +
                    configuration1.common.associatedUser.objectId;

                if (!USE_READABLE_TOPICS) {
                    associatedUserId = configuration1.common.associatedUser.objectId;
                }

                const mockDeviceControllerMatch = UUID_REGEX;
                const mockObjectControllerMatch = UUID_REGEX;

                // Check Discover-Resolve event pattern
                expect(Spy.get("MockDeviceController").value1)
                    .toHaveBeenCalledTimes(2);

                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(0)[0].eventData.object.name)
                    .toMatch(/MockObject_MockObjectController[12]/);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(0)[0].eventUserId)
                    .toBe(undefined);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(0)[0].eventSourceId)
                    .toMatch(mockObjectControllerMatch);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(0)[0].eventType)
                    .toBe(CommunicationEventType.Resolve);

                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(1)[0].eventData.object.name)
                    .toMatch(/MockObject_MockObjectController[12]/);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(1)[0].eventUserId)
                    .toBe(undefined);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(1)[0].eventSourceId)
                    .toMatch(mockObjectControllerMatch);
                expect(Spy.get("MockDeviceController").value1
                    .calls.argsFor(1)[0].eventType)
                    .toBe(CommunicationEventType.Resolve);

                expect(Spy.get("MockObjectController1").value1)
                    .toHaveBeenCalledTimes(1);
                expect(Spy.get("MockObjectController1").value1
                    .calls.argsFor(0)[0].eventUserId)
                    .toBe(CommunicationTopic.uuidFromLevel(associatedUserId));
                expect(Spy.get("MockObjectController1").value1
                    .calls.argsFor(0)[0].eventSourceId)
                    .toMatch(mockDeviceControllerMatch);
                expect(Spy.get("MockObjectController1").value1
                    .calls.argsFor(0)[0].eventType)
                    .toBe(CommunicationEventType.Discover);
                expect(Spy.get("MockObjectController1").value1
                    .calls.argsFor(0)[0].eventData.objectTypes)
                    .toContain("coaty.test.MockObject");

                expect(Spy.get("MockObjectController2").value1)
                    .toHaveBeenCalledTimes(1);
                expect(Spy.get("MockObjectController2").value1
                    .calls.argsFor(0)[0].eventUserId)
                    .toBe(CommunicationTopic.uuidFromLevel(associatedUserId));
                expect(Spy.get("MockObjectController2").value1
                    .calls.argsFor(0)[0].eventSourceId)
                    .toMatch(mockDeviceControllerMatch);
                expect(Spy.get("MockObjectController2").value1
                    .calls.argsFor(0)[0].eventType)
                    .toBe(CommunicationEventType.Discover);
                expect(Spy.get("MockObjectController2").value1
                    .calls.argsFor(0)[0].eventData.objectTypes)
                    .toContain("coaty.test.MockObject");

                // Check state changes of MockDeviceController
                // Note: the third Offline event is not 
                // emitted until the container is shut down.
                expect(Spy.get("MockDeviceController").value2)
                    .toHaveBeenCalledTimes(2);
                expect(Spy.get("MockDeviceController").value2
                    .calls.argsFor(0)[0])
                    .toBe(CommunicationState.Offline);
                expect(Spy.get("MockDeviceController").value2
                    .calls.argsFor(1)[0])
                    .toBe(CommunicationState.Online);

                // Check identity advertisements of MockDeviceController
                expect(Spy.get("MockObjectController1").value2)
                    .toHaveBeenCalledTimes(1);
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventUserId)
                    .toBe(CommunicationTopic.uuidFromLevel(associatedUserId));
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventSourceId)
                    .toMatch(mockDeviceControllerMatch);
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventType)
                    .toBe(CommunicationEventType.Advertise);
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventData.object.coreType)
                    .toBe("Component");
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventData.object.objectType)
                    .toBe(CoreTypes.OBJECT_TYPE_COMPONENT);
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventData.object.parentObjectId)
                    .toBe(container1.getCommunicationManager().identity.objectId);
                expect(Spy.get("MockObjectController1").value2
                    .calls.argsFor(0)[0].eventData.object.name)
                    .toBe("MockDeviceController1");

                expect(Spy.get("MockObjectController2").value2)
                    .toHaveBeenCalledTimes(1);
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventUserId)
                    .toBe(CommunicationTopic.uuidFromLevel(associatedUserId));
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventSourceId)
                    .toMatch(mockDeviceControllerMatch);
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventType)
                    .toBe(CommunicationEventType.Advertise);
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventData.object.coreType)
                    .toBe("Component");
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventData.object.objectType)
                    .toBe(CoreTypes.OBJECT_TYPE_COMPONENT);
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventData.object.parentObjectId)
                    .toBe(container1.getCommunicationManager().identity.objectId);
                expect(Spy.get("MockObjectController2").value2
                    .calls.argsFor(0)[0].eventData.object.name)
                    .toBe("MockDeviceController1");

                // Check custom identity properties of communication manager in container1
                expect(container1.getCommunicationManager().identity.name)
                    .toBe("Agent1");
            });
        }, TEST_TIMEOUT);

        it("all Advertise events are received", (done) => {

            const deviceController = container1.getController<mocks.MockDeviceController>("MockDeviceController");
            const logger: mocks.AdvertiseEventLogger = {
                count: 0,
                eventData: [],
            };
            const eventCount = 4;

            deviceController.watchForAdvertiseEvents(logger);

            delayAction(500, undefined, () => {
                container2
                    .getController<mocks.MockObjectController>("MockObjectController")
                    .publishAdvertiseEvents(eventCount);

                delayAction(1000, done, () => {
                    expect(logger.count).toBe(eventCount * 2);
                    expect(logger.eventData.length).toBe(eventCount * 2);
                    for (let n = 1, i = 0; n <= eventCount; n++) {
                        expect(logger.eventData[i++].object.name).toBe("Advertised_" + n);
                        expect(logger.eventData[i++].object.name).toBe("Advertised_" + n);
                    }
                });
            });
        }, TEST_TIMEOUT);

        it("throws on invalid Channel event identifier", () => {
            expect(() => ChannelEvent.withObject(
                container2.getController<mocks.MockObjectController>("MockObjectController").identity,
                "/foo/+/",
                {
                    objectId: container2.getRuntime().newUuid(),
                    objectType: CoreTypes.OBJECT_TYPE_OBJECT,
                    coreType: "CoatyObject",
                    name: "Channeled",
                }))
                .toThrow();
        });

        it("not throws on valid Channel event identifier", () => {
            expect(() => ChannelEvent.withObject(
                container2.getController<mocks.MockObjectController>("MockObjectController").identity,
                "foo_bar-baz",
                {
                    objectId: container2.getRuntime().newUuid(),
                    objectType: CoreTypes.OBJECT_TYPE_OBJECT,
                    coreType: "CoatyObject",
                    name: "Channeled",
                }))
                .not.toThrow();
        });

        it("all Channel events are received", (done) => {

            const deviceController = container1.getController<mocks.MockDeviceController>("MockDeviceController");
            const logger: mocks.ChannelEventLogger = {
                count: 0,
                eventData: [],
            };
            const eventCount = 4;
            const channelId = "CHANNEL_ID_42";

            deviceController.watchForChannelEvents(logger, channelId);

            delayAction(500, undefined, () => {
                container2
                    .getController<mocks.MockObjectController>("MockObjectController")
                    .publishChannelEvents(eventCount, channelId);

                delayAction(1000, done, () => {
                    expect(logger.count).toBe(eventCount);
                    expect(logger.eventData.length).toBe(eventCount);
                    for (let i = 1; i <= eventCount; i++) {
                        expect(logger.eventData[i - 1].object.name).toBe("Channeled_" + i);
                    }
                });
            });
        }, TEST_TIMEOUT);

        it("all Call - Return events are handled", (done) => {

            const callController = container1.getController<mocks.MockOperationsCallController>("MockOperationsCallController");
            const contextFilter1: ContextFilter = { conditions: ["floor", filterOp.between(6, 8)] };
            const contextFilter2: ContextFilter = { conditions: ["floor", filterOp.equals(10)] };
            const logger: mocks.ReturnEventLogger = { eventData: {} };

            delayAction(500, undefined, () => {
                callController.publishCallEvent("coaty.test.switchLight", { state: "on", color: "green" }, contextFilter1, logger, "res11");
                callController.publishCallEvent("coaty.test.switchLight", { state: "on", color: "black" }, contextFilter1, logger, "res12");
                callController.publishCallEvent("coaty.test.switchLight", { state: "on", color: "red" }, contextFilter2, logger, "res13");
                callController.publishCallEvent("coaty.test.switchLight", { state: "off" }, contextFilter1, logger, "res14");
                callController.publishCallEvent("coaty.test.switchLight", { state: "off" }, undefined, logger, "res15");
                callController.publishCallEvent("coaty.test.add", [42, 43], undefined, logger, "res2");
                callController.publishCallEvent("coaty.test.add", [], undefined, logger, "res3");
                callController.publishCallEvent("coaty.test.undefined", {}, undefined, logger, "res4");

                delayAction(1000, done, () => {
                    const expectedResultCount = 6;
                    expect(Object.keys(logger.eventData).length).toBe(expectedResultCount);

                    expect(logger.eventData.res11.isError).toBe(false);
                    expect(logger.eventData.res11.error).toBeUndefined();
                    expect(logger.eventData.res11.result).toEqual({ color: "green", state: "on" });
                    expect(logger.eventData.res11.executionInfo).toEqual({ duration: 4711 });

                    expect(logger.eventData.res12.isError).toBe(true);
                    expect(logger.eventData.res12.error).toEqual({
                        code: RemoteCallErrorCode.InvalidParameters,
                        message: RemoteCallErrorMessage.InvalidParameters,
                    });
                    expect(logger.eventData.res12.result).toBeUndefined();
                    expect(logger.eventData.res12.executionInfo).toEqual({ duration: 4711 });

                    expect(logger.eventData.res13).toBeUndefined();

                    expect(logger.eventData.res14.isError).toBe(false);
                    expect(logger.eventData.res14.error).toBeUndefined();
                    expect(logger.eventData.res14.result).toEqual({ state: "off" });
                    expect(logger.eventData.res14.executionInfo).toEqual({ duration: 4711 });

                    expect(logger.eventData.res15.isError).toBe(false);
                    expect(logger.eventData.res15.error).toBeUndefined();
                    expect(logger.eventData.res15.result).toEqual({ state: "off" });
                    expect(logger.eventData.res15.executionInfo).toEqual({ duration: 4711 });

                    expect(logger.eventData.res2.isError).toBe(false);
                    expect(logger.eventData.res2.error).toBeUndefined();
                    expect(logger.eventData.res2.result).toEqual(85);
                    expect(logger.eventData.res2.executionInfo).toEqual({ duration: 4712 });

                    expect(logger.eventData.res3.isError).toBe(true);
                    expect(logger.eventData.res3.error).toEqual({
                        code: RemoteCallErrorCode.InvalidParameters,
                        message: RemoteCallErrorMessage.InvalidParameters,
                    });
                    expect(logger.eventData.res3.result).toBeUndefined();
                    expect(logger.eventData.res3.executionInfo).toEqual({ duration: 4712 });

                    expect(logger.eventData.res4).toBeUndefined();
                });
            });
        }, TEST_TIMEOUT);

        it("throws on invalid Raw topics", () => {
            expect(() => container2.getCommunicationManager()
                .publishRaw("", "abc"))
                .toThrow();
            expect(() => container2.getCommunicationManager()
                .publishRaw("foo/\0", "abc"))
                .toThrow();
            expect(() => container2.getCommunicationManager()
                .publishRaw("/foo/+", "abc"))
                .toThrow();
            expect(() => container2.getCommunicationManager()
                .publishRaw("/foo/#", "abc"))
                .toThrow();
        });

        it("all Raw topics are received", (done) => {

            const deviceController = container1.getController<mocks.MockDeviceController>("MockDeviceController");
            const logger1: mocks.RawEventLogger = {
                count: 0,
                eventData: [],
            };
            const logger2: mocks.RawEventLogger = {
                count: 0,
                eventData: [],
            };
            const eventCount = 3;
            const topicFilter1 = "/test/42/";
            const topicFilter2 = `/${CommunicationTopic.PROTOCOL_NAME}/#`;
            const topic2 = `/${CommunicationTopic.PROTOCOL_NAME}/1/Advertise:CoatyObject/`;

            deviceController.watchForRawEvents(logger1, topicFilter1, topicFilter1);
            deviceController.watchForRawEvents(logger2, topicFilter2, topic2);

            delayAction(500, undefined, () => {
                container2.getController<mocks.MockObjectController>("MockObjectController")
                    .publishRawEvents(eventCount, topicFilter1);
                container2
                    .getController<mocks.MockObjectController>("MockObjectController")
                    .publishRawEvents(eventCount, topic2);

                delayAction(1000, done, () => {
                    expect(logger1.count).toBe(eventCount);
                    expect(logger1.eventData.length).toBe(eventCount);
                    for (let i = 1; i <= eventCount; i++) {
                        expect(logger1.eventData[i - 1][0]).toBe(topicFilter1);
                        expect(logger1.eventData[i - 1][1]).toBe(`${i}`);
                    }
                    expect(logger2.count).toBe(eventCount);
                    expect(logger2.eventData.length).toBe(eventCount);
                    for (let i = 1; i <= eventCount; i++) {
                        expect(logger2.eventData[i - 1][0]).toBe(topic2);
                        expect(logger2.eventData[i - 1][1]).toBe(`${i}`);
                    }
                });
            });
        }, TEST_TIMEOUT);
    });

    describe("Intra-Container Communication", () => {

        const TEST_TIMEOUT = 10000;

        const components: Components = {
            controllers: {
                MockDeviceController: mocks.MockDeviceController,
                MockObjectController: mocks.MockObjectController,
            },
        };

        const configuration: Configuration = {
            common: {
                associatedUser: {
                    name: "Fred",
                    objectType: CoreTypes.OBJECT_TYPE_USER,
                    coreType: "User",
                    objectId: "f608cdb1-3350-4c62-8feb-4589f26f2efe",
                    names: {
                        givenName: "Fred",
                        familyName: "Feuerstein",
                    },
                },
            },
            communication: {
                shouldAutoStart: true,
                shouldAdvertiseIdentity: false,
                shouldAdvertiseDevice: false,
                brokerUrl: "mqtt://localhost:1898",
            },
            controllers: {
                MockDeviceController: {
                },
                MockObjectController: {
                    name: "MockObjectController",
                    responseDelay: 0,
                },
            },
        };

        let container: Container;

        beforeAll(done => {
            Spy.reset();

            delayAction(0, done, () => {
                container = Container.resolve(components, configuration);
            });
        });

        afterAll(
            done => {
                container.shutdown();

                Spy.reset();

                delayAction(1000, done, () => {
                    // give Mosca time to log output messages
                });
            },
            TEST_TIMEOUT);

        it("All Advertise non-echo events are received", (done) => {

            const deviceController = container.getController<mocks.MockDeviceController>("MockDeviceController");
            const objectController = container.getController<mocks.MockObjectController>("MockObjectController");
            const logger: mocks.AdvertiseEventLogger = {
                count: 0,
                eventData: [],
            };
            const eventCount = 4;

            deviceController.watchForAdvertiseEvents(logger);

            // To validate that echo events are properly suppressed
            objectController.watchForAdvertiseEvents(logger);

            delayAction(1000, undefined, () => {
                objectController.publishAdvertiseEvents(eventCount);

                delayAction(1000, done, () => {
                    expect(logger.count).toBe(eventCount * 2);
                    expect(logger.eventData.length).toBe(eventCount * 2);
                    for (let n = 1, i = 0; n <= eventCount; n++) {
                        expect(logger.eventData[i++].object.name).toBe("Advertised_" + n);
                        expect(logger.eventData[i++].object.name).toBe("Advertised_" + n);
                    }
                });
            });
        }, TEST_TIMEOUT);

    });

});
