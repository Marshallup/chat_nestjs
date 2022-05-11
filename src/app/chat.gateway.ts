import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ACTIONS } from './chat.actions';
import { version, validate } from 'uuid';

@WebSocketGateway(180, { namespace: 'chat' })
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer() server: Namespace;

  private logger: Logger = new Logger('AppGateway');

  private getClientRooms() {
    const { rooms } = this.server.adapter;

    return Array.from(rooms.keys()).filter(
      (roomID) => validate(roomID) && version(roomID) === 4,
    );
  }

  private getAllRoomsByID(roomID: string): string[] {
    const { rooms } = this.server.adapter;

    return Array.from(rooms.get(roomID) || []);
  }

  private leaveRoom(@ConnectedSocket() client: Socket) {
    const { rooms } = this.server.adapter;

    Array.from(rooms.keys()).forEach((roomID) => {
      const clients = this.getAllRoomsByID(roomID);

      clients.forEach((clientID) => {
        client.to(clientID).emit(ACTIONS.REMOVE_PEER, {
          peerID: client.id,
        });

        client.emit(ACTIONS.REMOVE_PEER, {
          peerID: clientID,
        });
      });

      client.leave(roomID);
    });

    this.shareRoomsInfo();
  }

  private shareRoomsInfo() {
    this.server.emit(ACTIONS.SHARE_ROOMS, {
      rooms: this.getClientRooms(),
    });
  }

  @SubscribeMessage('message')
  handleMessage(@MessageBody() message: string): void {
    this.server.emit('message', message);
  }
  afterInit() {
    this.logger.log('Init');
  }
  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Клиент отключился id: ${client.id}`);
    this.leaveRoom(client);
  }
  handleConnection(@ConnectedSocket() client: Socket) {
    this.shareRoomsInfo();

    client.on(ACTIONS.JOIN, (config) => {
      const { room: roomID } = config;
      const { rooms: joinedRooms } = client;

      if (Array.from(joinedRooms).includes(roomID)) {
        return console.warn(`Уже подключен к комнате ${roomID}`);
      }

      const clients = this.getAllRoomsByID(roomID);

      clients.forEach((clientID: string) => {
        this.server.to(clientID).emit(ACTIONS.ADD_PEER, {
          peerID: client.id,
          createOffer: false,
        });

        client.emit(ACTIONS.ADD_PEER, {
          peerID: clientID,
          createOffer: true,
        });
      });

      client.join(roomID);

      this.shareRoomsInfo();
    });

    client.on(ACTIONS.LEAVE, () => {
      this.leaveRoom(client);
    });
    client.on(ACTIONS.RELAY_SDP, ({ peerID, sessionDescription }) => {
      this.server.to(peerID).emit(ACTIONS.SESSION_DESCRIPTION, {
        peerID: client.id,
        sessionDescription,
      });
    });

    client.on(ACTIONS.RELAY_ICE, ({ peerID, iceCandidate }) => {
      this.server.to(peerID).emit(ACTIONS.ICE_CANDIDATE, {
        peerID: client.id,
        iceCandidate,
      });
    });

    this.logger.log(`Клиент подключился id: ${client.id}`);
  }
}
