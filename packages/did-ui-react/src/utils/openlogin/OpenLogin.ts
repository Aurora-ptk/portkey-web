import PopupHandler from './PopupHandler';
import { OPENLOGIN_ACTIONS, UX_MODE, openLoginRedirectURI } from './constants';
import { LoginParams, OpenLoginOptions, OpenloginParamConfig, PopupResponse } from './types';
import { WEB_PAGE, WEB_PAGE_TEST, WEB_PAGE_TESTNET } from '../../constants';
import { dealURLLastChar, randomId } from '../lib';
import { constructURL, jsonToBase64 } from './utils';
import { ISocialLogin } from '../../types';
import { forgeWeb } from '@portkey/utils';
import { IOpenloginHandlerResult, TOpenLoginQueryParams } from '../../types/openlogin';
import { CrossTabPushMessageType } from '@portkey/socket';

class OpenLogin {
  options: OpenLoginOptions;

  constructor(options: OpenLoginOptions) {
    if (!options.customNetworkType) options.customNetworkType = 'online';

    if (!options.sdkUrl) {
      if (options.customNetworkType === 'local') options.sdkUrl = 'http://localhost:3000';
      if (options.customNetworkType === 'offline') options.sdkUrl = WEB_PAGE_TEST;
      if (options.customNetworkType === 'online')
        options.sdkUrl = options.networkType === 'TESTNET' ? WEB_PAGE_TESTNET : WEB_PAGE;
    }

    if (!options.uxMode) options.uxMode = UX_MODE.POPUP;
    if (typeof options.replaceUrlOnRedirect !== 'boolean') options.replaceUrlOnRedirect = true;
    if (!options.storageKey) options.storageKey = 'local';
    this.options = options;
  }

  get serviceURI(): string {
    return dealURLLastChar(this.options.serviceURI);
  }

  get socketURI(): string {
    if (this.options.socketURI) return dealURLLastChar(this.options.socketURI);
    return `${this.serviceURI}/communication`;
  }

  private get baseUrl(): string {
    if (this.options.sdkUrl) return `${this.options.sdkUrl}`;
    return WEB_PAGE;
  }

  getRedirectURI(loginProvider: ISocialLogin) {
    const serviceURI = this.serviceURI;
    const path = openLoginRedirectURI[loginProvider];

    return `${serviceURI}${path}`;
  }

  async login(params: LoginParams): Promise<PopupResponse | null> {
    const { loginProvider } = params;
    if (!loginProvider) throw `SocialLogin type is required`;

    const dataObject: OpenloginParamConfig = {
      clientId: this.options.clientId,
      ...params,
      actionType: OPENLOGIN_ACTIONS.LOGIN,
      serviceURI: this.serviceURI,
    };
    console.log(dataObject, 'dataObject==');
    const result = await this.openloginHandler({
      url: `${this.baseUrl}/social-start`,
      queryParams: dataObject,
      socketMethod: [CrossTabPushMessageType.onAuthStatusChanged],
    });

    // const result = {
    //   token:
    //     'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OTkwODQ4MDM3IiwiYXV0aERhdGUiOiIxNzEyNTI4NjEwIiwiZmlyc3ROYW1lIjoiQXVyb3JhIiwiaGFzaCI6ImE5NjhhNDBiMmY0MTJhMzE3ZWQxM2IwODE0ZTY4MmNlMDM0OThlNzgxZTk3MTllMWI2NzRiZTg4ZWJjMWNiMGYiLCJuYmYiOjE3MTE1MTgzOTEsImV4cCI6MTcxMTUyMTk5MSwiaXNzIjoiUG9ydEtleSIsImF1ZCI6IlBvcnRLZXkifQ.GMUVh2ZoWH0fL13sDwSKdA9Z1zcqgOKph5VZP37JmqAiUfW9gCxmpsWUhcG-ZysBhfAOG5UoP7JR8yFcgCVBT37YXF-RtA0dBl65k1W7mse1e1fUmvOgWJQY2Jdz4VMtT_JY7T6fF7SB63vNwBSNKo1GGanJPLMy4ZGVupF6TNHIiBYzvrKH-j32BS5EJ1rEB4yEsH49Y2eBpTmKDZd_mlisfM2lc5VOe5zv2cLBuUVMdAsQHYI-Dh0GZV2xbYcA_EqtHfkO7Gwjs0T-K5LCsc5EInCiScpe0lQPCMTML_4y1T-fKPMY0MTG0r6dZwq7rKDbLCMFTxS-EUDTGvuKEA',
    //   provider: 'Telegram' as ISocialLogin,
    // };

    if (!result) return null;
    if (this.options.uxMode === UX_MODE.REDIRECT) return null;
    return result.data as PopupResponse;
  }

  async getLoginId(): Promise<string> {
    const loginId = randomId();

    return loginId;
  }

  async openloginHandler({
    url,
    queryParams,
    socketMethod,
    popupTimeout = 1000,
    needConfirm = false,
  }: {
    url: string;
    queryParams: TOpenLoginQueryParams;
    socketMethod: Array<CrossTabPushMessageType>;
    popupTimeout?: number;
    needConfirm?: boolean;
  }): Promise<IOpenloginHandlerResult | undefined> {
    const loginId = await this.getLoginId();

    queryParams.loginId = loginId;
    queryParams.network = this.options.customNetworkType;

    if (this.options.uxMode === UX_MODE.REDIRECT) {
      const loginUrl = constructURL({
        baseURL: url,
        query: { b64Params: jsonToBase64(queryParams) },
      });
      window.location.href = loginUrl;
      return undefined;
    }
    // Get publicKey and privateKey
    const cryptoManager = new forgeWeb.ForgeCryptoManager();
    const keyPair = await cryptoManager.generateKeyPair();

    queryParams.publicKey = keyPair.publicKey;
    const loginUrl = constructURL({
      baseURL: url,
      query: { b64Params: jsonToBase64(queryParams) },
    });

    const currentWindow = new PopupHandler({
      url: loginUrl,
      socketURI: this.socketURI,
      timeout: popupTimeout,
    });

    return new Promise((resolve, reject) => {
      currentWindow.on('close', () => {
        reject('User close the prompt');
      });

      currentWindow
        .listenOnChannel(loginId, socketMethod)
        .then(async (res) => {
          const decrypted = await cryptoManager.decryptLong(keyPair.privateKey, res.message);
          let result;

          try {
            result = JSON.parse(decrypted);
          } catch (error) {
            result = decrypted;
          }
          resolve({ data: result, methodName: res.methodName });
        })
        .catch(reject);
      // TODO  Invoke get result and socket listen
      // currentWindow.on('socket-connect', () => {
      //   try {
      currentWindow.open({ needConfirm });
      //   } catch (error) {
      //     reject(error);
      //   }
      // });
    });
  }
}

export default OpenLogin;
