/*! Copyright (c) 2018 Siemens AG. Licensed under the MIT License. */

import { Subscription } from "rxjs";

import { CommunicationManager, OperatingState } from "../com/communication-manager";
import { Controller, IController, IControllerStatic } from "../controller/controller";

import { Configuration, ControllerConfig } from "./configuration";
import { Runtime } from "./runtime";

/**
 * Defines the application-specific container components to be registered
 * with a Coaty Container.
 *
 * The configuration options for the container component classes
 * are specified in the `controllers` options of a Configuration object.
 */
export interface Components {

    /**
     * Application-specific controller classes to be registered
     * with the runtime container. The configuration options for a
     * controller class listed here are specified in the controller
     * configuration under a key that matches the associated name of the
     * controller.
     */
    controllers?: { [controllerName: string]: IControllerStatic<Controller> };
}

/**
 * An IoC container that uses constructor dependency injection to
 * create container components and to resolve dependencies.
 * This container defines the entry and exit points for any Coaty application
 * providing lifecycle management for its components.
 */
export class Container {

    private _runtime: Runtime;
    private _comManager: CommunicationManager;
    private _controllers = new Map<string, [IController, IControllerStatic<IController>]>();
    private _isShutdown = false;
    private _operatingStateSubscription: Subscription;

    /**
     * Creates and bootstraps a Coaty container by registering and resolving
     * the given components and configuration options.
     * @param components the components to set up within this container
     * @param configuration the configuration options for the components
     * @param configTransformer a function to transform the given configuration (optional)
     * @returns a Container for the given components
     * @throws if configuration is falsy.
     */
    static resolve(
        components: Components,
        configuration: Configuration,
        configTransformer?: (config: Configuration) => Configuration): Container {
        const container = new Container();

        if (configTransformer) {
            configuration = configTransformer(configuration);
        }
        container._resolveComponents(components || {}, configuration);

        return container;
    }

    /**
     * Asynchronously creates and bootstraps a Coaty container by registering and
     * resolving the given components and configuration options.
     * Use this method if configuration should be retrieved asnychronously
     * (e.g. via HTTP) by one of the predefined runtime configuration providers
     * (see runtime-angular, runtime-node).
     * The promise returned will be rejected if the configuration could not be
     * retrieved or has a falsy value.
     * @param components the components to set up within this container
     * @param configuration a promise for the configuration options
     * @param configTransformer a function to transform the retrieved configuration (optional)
     * @returns a promise on a Container for the given components
     */
    static resolveAsync(
        components: Components,
        configuration: Promise<Configuration>,
        configTransformer?: (config: Configuration) => Configuration,
    ): Promise<Container> {
        return new Promise<Container>((resolve, reject) => {
            configuration.then(
                config => {
                    resolve(Container.resolve(components, config, configTransformer));
                },
                reason => {
                    reject(new Error(`Couldn't fetch async configuration: ${reason}`));
                });
        });
    }

    /**
     * Dynamically registers and resolves the given controller class
     * with the specified controller config options.
     * The request is silently ignored if the container has already
     * been shut down.
     * 
     * @param controllerName the name of the controller (must match the name associated with the controller in `Components`)
     * @param controllerType the class type of the controller
     * @param config the controller's configuration options
     * @returns the resolved controller instance or `undefined` if no controller could be resolved
     */
    registerController<T extends IController>(
        controllerName: string,
        controllerType: IControllerStatic<T>,
        config: ControllerConfig) {

        if (this._isShutdown) {
            return;
        }

        const ctrl = this._resolveController(controllerName, controllerType, this._runtime, config, this._comManager);
        if (ctrl) {
            ctrl.onContainerResolved(this);
            this._comManager.observeOperatingState()
                .subscribe(opState => {
                    if (opState === OperatingState.Started ||
                        opState === OperatingState.Starting) {
                        this._dispatchOperatingState(OperatingState.Starting, ctrl);
                    }
                })
                .unsubscribe();
        }
        return ctrl as T;
    }

    /**
     * Gets the runtime object of this container.
     */
    getRuntime() {
        return this._runtime;
    }

    /**
     * Gets the communication manager of this container.
     */
    getCommunicationManager() {
        return this._comManager;
    }

    /**
     * Gets the registered controller of the given controller name.
     * Returns undefined if a controller with the given name is not registered in the `Components`.
     * @param controllerName the name of the controller specified as `Components` key for the controller
     */
    getController<T extends IController>(controllerName: string): T {
        return this._controllers && this._controllers.get(controllerName)[0] as T;
    }

    /**
     * Creates a new array with the results of calling the provided callback
     * function once for each registered controller name/controllerType/controller instance 
     * triple.
     * @param callback function that returns an element of the new array
     */
    mapControllers<T>(callback: (controllerName: string, controllerType: IControllerStatic<IController>, controller: IController) => T) {
        const results: T[] = [];
        this._controllers && this._controllers.forEach((value, name) => results.push(callback(name, value[1], value[0])));
        return results;
    }

    /**
     * The exit point for a Coaty applicaton.
     * Releases all registered container components and its associated system resources.
     * This container should no longer be used afterwards.
     */
    shutdown() {
        if (this._isShutdown) {
            // Fail-safe
            return;
        }
        this._isShutdown = true;
        this._releaseComponents();
    }

    private _resolveComponents(components: Components, config: Configuration) {
        if (!config) {
            throw new Error("Container: Configuration is not defined");
        }

        const runtime = this._runtime = new Runtime(config.common, config.databases);
        const comManager = this._comManager = new CommunicationManager(runtime, config.communication);

        // Resolve controllers
        components.controllers &&
            Object.keys(components.controllers).forEach(controllerName => {
                const controllerType = components.controllers[controllerName];
                this._resolveController(controllerName, controllerType, runtime, config.controllers, comManager);
            });

        // Then call initialization method of each controller
        this._controllers &&
            this._controllers.forEach(ctrl => ctrl[0].onContainerResolved(this));

        // Observe operating state and dispatch to registered controllers
        this._operatingStateSubscription = comManager.observeOperatingState()
            .subscribe(state => this._controllers &&
                this._controllers.forEach(ctrl => this._dispatchOperatingState(state, ctrl[0])));

        // Finally start communication manager if auto-connect option is set
        if (config.communication.shouldAutoStart) {
            comManager.start();
        }
    }

    private _resolveController<T extends IController>(
        controllerName: string,
        controllerType: IControllerStatic<T>,
        runtime: Runtime,
        config: ControllerConfig,
        comManager: CommunicationManager): IController {
        if (controllerName && controllerType) {
            const ctrl = new controllerType(runtime, (config && config[controllerName]) || {}, comManager, controllerName);
            ctrl.onInit();
            this._controllers.set(controllerName, [ctrl, controllerType]);
            return ctrl;
        }
        return undefined;
    }

    private _releaseComponents() {
        // Dispose Communication Manager first to trigger operating state changes
        this._comManager.onDispose();
        this._controllers.forEach(ctrl => ctrl[0].onDispose());

        this._operatingStateSubscription && this._operatingStateSubscription.unsubscribe();

        this._controllers = undefined;
        this._comManager = undefined;
        this._runtime = undefined;
    }

    private _dispatchOperatingState(state: OperatingState, ctrl: IController) {
        switch (state) {
            case OperatingState.Starting:
                ctrl.onCommunicationManagerStarting();
                break;
            case OperatingState.Stopping:
                ctrl.onCommunicationManagerStopping();
                break;
            default:
                break;
        }
    }
}
