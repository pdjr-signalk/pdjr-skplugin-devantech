# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
DS range of general-purpose relay modules.

## Description

**pdjr-skplugin-devantech** implements an interface for Devantech DS
series Ethernet relay devices.
Each model in the DS range provides a mix of general purpose I/O and
relay output channels: the number of each type varies from model to
model.
On some devices I/O channels can be configured as digital (switch)
inputs or ADC inputs, but the current version of this plugin only
supports switch input use.

A DS module is identified in the plugin by its IP address but it can
be represented in Signal K as a switchbank called after this address
or by any unique user-configured name.

The plugin listens on a specified TCP port for status reports from
configured DS devices and uses the received data to update Signal K
switchbank paths associated with the transmitting device.

Receipt of status notifications from a DS device causes the plugin to
establish and maintain a persistent TCP connection to the notifying
device allowing subsequent operation of remote relays in response to
Signal K PUT requests on associated switchbank relay channels.

This operating strategy is resilient to network outage and allows
*ad-hoc* connection of DS devices.

In addition to switchbank monitoring and control the plugin also
provides a mechanism for decorating associated switchbank paths with
automatically generated and user supplied metadata.

## Configuration

### Preparing a DS module for use with this plugin

Refer to the DS device user manual for details on how to install the
device, then use the ```_config.htm``` dashboard to make the following
configuration.

<dl>
  <dt>Network</dt>
  <dd>
    <p>
    Assign the DS device a static IP address on your LAN and specify a
    control port number.
    Make sure that the control port number you choose is not blocked by
    any firewalls on your Signal K host and/or network router.
    If you have more than one DS device on your network, use the same
    port number on every device.
    </p>
  </dd>
  <dt>Relays</dt>
  <dd>
    <p>
    Set 'Relay Name' if you wish.
    Set 'Pulse/Follow' to ```0```.
    Set 'Power-up Restore' to suit your needs.
    Set all other fields to blank.
    </p>
  </dd>
  <dt>Input/Output</dt>
  <dd>
    <p>
    For all I/O channels.
    Set 'Name' if you wish.
    Set 'Type' to ```Digital With Pullup```.
    Set 'Attached Relay Number' to ```None```.
    </p>
  </dd>
  <dt>Event Notifications</dt>
  <dd>
    <p>
    'Triggers' should be set to monitor events on the switch inputs and
    relay outputs supported by the DS device and also the virtual relay
    R32.
    For a four-relay DS device the trigger value will be
    ```{D1|D2|D3|D4|D5|D6|D7|D8|R1|R2|R3|R4|R32}```.
    </p>
    <p>
    'Target IP' should be set to the IP address of the Signal K host.
    </p>
    <p>
    'Target Port' should be set to some preferred value and, if you
    have more than one DS device then the same value should be used
    on all devices.
    Make sure any firewalls in your environment do not block your 
    chosen port.
    </p>
    <p>
    'TCP/IP Timeout' should be set to 100.
    </p>
  </dd>
  <dt>Timers</dt>
  <dd>
    <p>
    Select 'Counter No.' 1 and set 'Counter Input' to ```T1``` and
    'Reset Input' to ```C1>9```.
    </p>
  </dd>
  <dt>Relays</dt>
  <dd>
    <p>
    Select 'Relay No' 32 and set 'Pulse/Follow' to ```C1>4```.
    </p>
  </dd>
</dl>

Together thse steps ensure that an event notification message is sent
to the plugin immediately a switch input or relay output on the DS
device changes state.
Virtual relay R32 undergoes a state change every five seconds ensuring
a regular 'heartbeat' status update.

In Linux you can use ```nc``` to confirm status messages are being
transmitted appropriately.

### Plugin configuration

<dl>
  <dt>Metadata publication service configuration <code>metadataPublisher</code></dt>
  <dd>
    Optional object configuring access to a remote metadata publication
    service (a suitable service is implemented by the author's
    <a href='https://github.com/pdjr-signalk/pdjr-skplugin-metadata#readme'>metadata plugin</a>.
    <p>
    If this property is omitted, or if, for whatever reason, metadata cannot
    be published to the specified service then the plugin will inject metadata
    directly into the Signal K tree.</p>
    <dl>
      <dt>Metadata publication endpoint <code>endpoint</code></dt>
      <dd>
        Required URL of an API which will accept Signal K metadata and
        at least insert it into the Signal K tree.
        For example '/plugins/metadata/metadata'.
      </dd>
      <dt>Metadata publication method <code>method</code></dt>
      <dd>
        Optional string specifying the HTTP method which should be used
        to submit metadata to the publication service.
        Defaults to 'POST', but 'PUT' or 'PATCH' may be specified.
      </dd>
      <dt>Metadata publisher credentials <code>credentials</code></dt>
      <dd>
        Required string of the form 'username:password' specifying
        Signal K credentials that will allow access to the publication
        service.
      </dd>
    </dl>
  </dd>
  <dt>Port on which to listen for module status reports <code>statusListenerPort</code></dt>
  <dd>
    <p>
    Optional number specifying the TCP port on which the plugin will
    listen for DS event notificataions.
    Defaults to 28241.
    </p>
    <p>
    This value must match the 'Target port' value specified in the DS
    module's 'Event Notifications' configuration page.
    </p>
  </dd>
  <dt>Process the transmit queue every this many miliseconds <code>transmitQueueHeartbeat</code></dt>
  <dd>
    <p>
    Optional number specifying the transmit queue processing interval
    in milliseconds.
    Defaults to 25.
    </p>
  </dd>
  <dt>Module configurations <code>modules</code></dt>
  <dd>
    <p>
    Required array of *module* objects each of which defines a
    Devantech DS module that will be controlled by the plugin.
    Each entry has the following configuration properties.
    </p>
    <dl>
      <dt>Module IP address <code>ipAddress</code></dt>
      <dd>
        <p>
        Required string specifying the IP address of the module being
        configured.
        </p>
      </dd>
      <dt>Relay operation command port <code>commandPort</code></dt>
      <dd>
        <p>
        Optional number specifying the port on which the module listens
        for relay operating commands.
        This value must match the 'Control port' number specified on the
        DS module's 'Network' configuration page.
        </p>
      </dd>
      <dt>Password for command port access <code>password</code></dt>
      <dd>
        <p>
        Optional password securing the DS module's command interface.
        </p>
      </dd>
      <dt>Channels <code>channels</code></dt>
      <dd>
        <p>
        The channels array property defines the Signal K interface to
        the relay and switch channels supported by the DS module.
        Each item in the *channels* array is an object defining a
        single channel and had the following properties.
        </p>
        <dl>
          <dt>Channel index <code>index</code></dt>
          <dd>
            <p>
            Required string value giving a name which will be used to
            identify the channel in Signal K.
            This name <em>must</em> begin with either 'R' to identify
            a relay output channel or 'S' to identify a switch input
            channel.
            The remainder of the index name must be sufficient to
            ensure uniqueness within the relay or switch channel
            collection of the containing switchbank.
            There are advantages to making <em>index</em> a value of
            the form '<em>Tnn</em>' where <em>T</em> is either 'R' or
            'S' and <em>nn</em> is the associated DS channel address.
            For example, 'R01' would this identify relay 1 on the
            associated DS device, whilst 'S03' would identify digital
            input channel 3.
            </p>
          </dd>
          <dt>Channel address <code>address</code></dt>
          <dd>
            <p>
            Optional number value giving the address of the DS channel
            associated with <em>index</em>.
            If the recommended form for <em>index</em> (see above) is
            applied then this value will be derived automatically; if
            not, then it must be specified.
            </p>
          </dd>
          <dt>Description <code>description</code></dt>
          <dd>
          </dd>
        </dl>
      </dd>
    </dl>
  </dd>
</dl>

The plugin configuration has the following properties.

| Property name          | Value type | Value default | Description |
| :--------------------- | :---------- | :----------- | :---------- |
| modules                | Array       | (none)       | Collection of *module* objects. |
| statusListenerPort     | Number      | 24281        | The TCP port on which the plugin will listen for DS event notificataions. |
| transmitQueueHeartbeat | Number      | 25           | Transmit queue processing interval in milliseconds. |
| devices                | Array       | (see below)  | Collection of *device* objects.|


Most installations will only need to specify entries in this array,
leaving other properties to assume their defaults.

The *devices* array can be used to introduce new operating commands
for particular Devantech relay devices.
The plugin includes a definition with the id 'DS' for operating a
device using the DS ASCII protocol.

Each *module* object has the following properties.

| Property name      | Value type | Value default | Description |
| :----------------- | :--------- | :------------ | :---------- |
| id                 | String     | (none)        | Unique identifier that will be used as the 'bank' part of the Signal K switch path used to identify thus module's switch channels. |
| cstring            | String     | (none)        | Connection specification of the form '*address*:*port*' that gives the IP address of the physical device implementing this module and the TCP port number on which it listens for commands. |
| channels           | Array      | (none)        | Array of *channel* objects. |
| description        | String     | ''            | Text for the meta data 'description' property that will be associated with the Signal K switch bank *id*. |
| deviceid           | String     | 'DS'          | Id of the *device* defining the operating characteristics of this module. |

Each *channel* object has the following properties.

| Property name | Value type | Value default | Description |
| :----------   | :--------- | :------------ | :---------- |
| index         | Number     | (none)        | Identifier that will be used as the 'channel' part of the Signal K switch path used to identify this relay. Signal K convention starts channel numbering at 1. |
| address       | Number     | *index*       | Address of the physical channel on the remote device with which this channel is associated. |
| description   | String     | ''            | Text for the meta data 'description' property that will be associated with this channel in Signal K. |

My test configuration for a DS2824 looks like this:
```
{
  "enabled": true,
  "enableDebug": true,
  "configuration": {
    "modules": [
      {
        "id": "DS2824",
        "description": "DS2824 Test Module",
        "deviceid": "DS",
        "cstring": "192.168.1.145:17123",
        "channels": [
          { "index": 1, "description": "Relay 1" },
          { "index": 2, "description": "Relay 2" },
          { "index": 3, "description": "Relay 3" },
          { "index": 4, "description": "Relay 4" },
          { "index": 5, "description": "Relay 5" },
          { "index": 6, "description": "Relay 6" },
          { "index": 7, "description": "Relay 7" },
          { "index": 8, "description": "Relay 8" }
        ]
      }
    ]
  }
}
```

```
{
  "enabled": true,
  "enableDebug": false,
  "configuration": {
    "metadataPublisher": {
      "endpoint": "/plugins/metadata/metadata",
      "method": "POST",
      "credentials": "username:password"
    },
    "modules": [
      {
        "id": "helm-alarm"
        "ipAddress": "192.168.1.6",
        "commandPort": 17123,
        "description": "DS2242 Helm Alarm Module",
        "channels": [
          { "index": "r-beacon", "address": 1 },
          { "index": "r-sounder", "address": 2 },
          { "index": "s_MAIN_BILGE_LEVEL_SENSOR", "address": 1 },
          { "index": "s_MAIN_BILGE_FLOAT_SWITCH", "address": 2 },
          { "index": "s_ER_BILGE_LEVEL_SENSOR", "address": 3 },
          { "index": "s_ER_BILGE_FLOAT_SWITCH", "address": 4 }
        ]
      }
    ]
  }
}
```

### Device definitions

A *devices* array property can be included at the top-level of the
plugin configuration to add relay device definitions to those which are
pre-defined in the plugin or to override the existing 'DS' definition.
Each item in the 'devices' array is a *device* definition object which
describes the physical and interfacing characteristics of a supported
relay device.

The plugin includes this device definition suitable for DS-series relay
modules:
```
{
  "id": "DS",
  "channels": [
    {
      "address": 0,
      "oncommand": "SR {c} ON",
      "offcommand": "SR {c} OFF"
    }
  ]
}
```
Each device definition has the following properties.

| Property name | Value type | Value default | Description |
| :------------ | :--------- | :------------ | :---------- |
| id            | String     | (none)        | Space-separated list of identifiers, one for each of the relay devices to which the definition applies. Typically these identifiers should be the model number or model group name assigned by the device manufacturer. |
| channels      | Array      | (none)        | Array of *channel* definitions each of which specifies the commands required to operate a particular relay on the device being defined. |

Relays are identified by an ordinal *address* in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake channel with address 0 that will be elaborated for each of the
real channels on the device.

Each channel definition has the following properties.

| Property name | Value type | Value default | Description |
| :------------ | ---------- | :------------ | :---------- |
| address       | Number     | (none)        | Physical address of the relay that is being defined (or 0 for a generic definition). |
| oncommand     | String     | (none)        | Command that should be transmitted to the device to turn relay ON. |
| offcommand    | String     | (none)        | Command that should be transmitted to the device to turn relay OFF. |

Both *oncommand* and *offcommand* can contain embedded JSON escape
sequences.
Additionally, the following wildcard tokens will be substituted
with appropriate values before string transmission.

| Token | Replacement value |
| :---- | :---------------- |
| {c}   | The ASCII encoded address of the channel being processed. |
| {C}   | The binary encoded address of the channel being processed. |

## Operation

The plugin will start immediately it is installed but must be configured
with at least one 'module' definition before it can do something useful.

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
