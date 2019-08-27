/* Protocol meta info:
<NAME> Smart Battery system (SBS)  </NAME>
<DESCRIPTION>
Smart Battery System data analyzer (Compliant to specifications V1.1)
</DESCRIPTION>
<VERSION> 0.6 </VERSION>
<AUTHOR_NAME>  Ibrahim KAMAL </AUTHOR_NAME>
<AUTHOR_URL> i.kamal@ikalogic.com </AUTHOR_URL>
<HELP_URL> https://github.com/ikalogic/ScanaStudio-scripts-v3/wiki </HELP_URL>
<COPYRIGHT> Copyright Ibrahim KAMAL </COPYRIGHT>
<LICENSE>  This code is distributed under the terms of the GNU General Public License GPLv3 </LICENSE>
<RELEASE_NOTES>
V0.6: Update packet view color scheme
V0.5: Added packet and hex views
V0.2: Added dec_item_end() for each dec_item_new()
V0.1: Initial release
</RELEASE_NOTES>
*/

/*
	Note:
	======
	The SBS data analyzer script is based on the I2C script (not the SMBus script).

	This was decided to allows faster decoding process. Using the SMBus script instead
	(that is based on I2C script) would provide very little added value as compared
	to the processing overhead it will bring.
*/

/*
Future releases
~~~~~~~~~~~~~~~~
* Add pre-decoding support
* Write online documentation
*/

var SMB =
{
	ADDRESS : 0x01,
  	CMD : 0x02,
	DATA  : 0x04,
};

//Decoder GUI
function on_draw_gui_decoder()
{
  ScanaStudio.gui_add_ch_selector("ch_sda","SMBDAT Channel","SMBDAT");
  ScanaStudio.gui_add_ch_selector("ch_scl","SMBCLK Channel","SMBCLK");

  ScanaStudio.gui_add_new_tab("Advanced options",false);
    ScanaStudio.gui_add_check_box("pec_enable","Analyze last byte as PEC",true);
    ScanaStudio.gui_add_combo_box("address_opt","Address convention");
      ScanaStudio.gui_add_item_to_combo_box("7 bit address",true);
      ScanaStudio.gui_add_item_to_combo_box("8 bit address (inlcuding R/W flag)",false);
    ScanaStudio.gui_add_combo_box("address_format","Address display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
    ScanaStudio.gui_add_combo_box("data_format","Data display format");
      ScanaStudio.gui_add_item_to_combo_box("HEX",true);
      ScanaStudio.gui_add_item_to_combo_box("Binary",false);
      ScanaStudio.gui_add_item_to_combo_box("Decimal",false);
      ScanaStudio.gui_add_item_to_combo_box("ASCII",false);
  ScanaStudio.gui_end_tab();
}


//Global variables
var sampling_rate;
var state_machine;

function on_decode_signals(resume)
{
  if (!resume) //If resume == false, it's the first call to this function.
  {
      //initialization code goes here
      build_sbs_cmds();
      state_machine = 0;
      sampling_rate = ScanaStudio.get_capture_sample_rate();
      pec_enable = ScanaStudio.gui_get_value("pec_enable");
      address_opt = ScanaStudio.gui_get_value("address_opt");
      address_format = ScanaStudio.gui_get_value("address_format");
      data_format = ScanaStudio.gui_get_value("data_format");
      frame_state = SMB.ADDRESS;
      sm_data_bytes = [];
  }

  items = ScanaStudio.pre_decode("i2c.js",resume);
  var i;
  for (i = 0; i < items.length; i++)
  {
    items[i].pec = false; //Assume this is not the PEC byte
    sm_data_bytes.push(items[i]);
    //If SM packet is finished, process it
    if (items[i].content.indexOf("STOP") >= 0)
    {
      //[S][Addr][ACK][D][ACK][PEC][ACK][P]
      if ((pec_enable == true) && (sm_data_bytes.length > 7))
      {
        //ScanaStudio.console_info_msg("PEC is active");
        //Go back to the last data byte and set it as PEC
        sm_data_bytes[sm_data_bytes.length -3].pec = true;
      }
      var n;
      //ScanaStudio.console_info_msg("SM items="+sm_data_bytes.length);
      for (n = 0; n < sm_data_bytes.length; n++)
      {
        process_pm_item(sm_data_bytes[n]);
      }
      sm_data_bytes = [];
    }
  }
}

function process_pm_item(item)
{
  ScanaStudio.dec_item_new(item.channel_index, item.start_sample_index, item.end_sample_index);

  if (item.content.indexOf("RE-START") >= 0)
  {
    ScanaStudio.dec_item_add_content("RE-START");
    ScanaStudio.dec_item_add_content("RS");
    ScanaStudio.dec_item_add_content("R");
	ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Re-start", "",
									   ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
    frame_state = SMB.ADDRESS;
  }
  else if (item.content.indexOf("START") >= 0)
  {
    ScanaStudio.dec_item_add_content("START");
    ScanaStudio.dec_item_add_content("S");
	ScanaStudio.packet_view_add_packet(true, item.channel_index, item.start_sample_index, -1, "SBS", "CH" + (item.channel_index + 1),
									   ScanaStudio.get_channel_color(item.channel_index), ScanaStudio.get_channel_color(item.channel_index));
	ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Start", "",
									   ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
    frame_state = SMB.ADDRESS;
    crc8_reset();
  }
  else if (item.content.indexOf("STOP") >= 0)
  {
    ScanaStudio.dec_item_add_content("STOP");
    ScanaStudio.dec_item_add_content("P");
	ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Stop", "",
									   ScanaStudio.PacketColors.Wrap.Title, ScanaStudio.PacketColors.Wrap.Content);
    frame_state = SMB.ADDRESS;
  }
  else if (item.content.indexOf("NACK") >= 0)
  {
    ScanaStudio.dec_item_add_content("NACK");
    ScanaStudio.dec_item_add_content("N");
	ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "NACK", "",
									   ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
  }
  else if (item.content.indexOf("ACK") >= 0)
  {
    ScanaStudio.dec_item_add_content("ACK");
    ScanaStudio.dec_item_add_content("A");
  }
  else //It's any other address or data byte
  {
    var byte = Number(item.content);
    switch (frame_state) {
      case SMB.ADDRESS:
        if (byte == 0) //General call
        {
          operation_str = "General call address ";
          operation_str_short = "G ";
        }
        else if (byte == 1) //General call
        {
          operation_str = "Start byte ";
          operation_str_short = "SB ";
        }
        else if ((byte>>1) == 1) //CBUS
        {
          operation_str = "CBUS address ";
          operation_str_short = "CBUS ";
        }
        else if ((byte >> 1) == 0x8)  //SMBus Host
        {
          operation_str = "SMBus host address ";
          operation_str_short = "HOST ";
        }
        else if ((byte >> 1) == 0xC)  //SMBus Alert response
        {
          operation_str = "SMBus Alert response address ";
          operation_str_short = "ALERT ";
        }
        else if ((byte>>3) == 1) //HS-mode master code
        {
          hs_mode = true;
          operation_str = "NOT SUPPORTED: HS-Mode master code ";
          operation_str_short = "! HS ";
          ScanaStudio.dec_item_emphasize_warning();
        }
        else if ((byte >> 3) == 0x1E) //10 bit (extended) address
        {
          add_10b = true;
          ext_add = (byte>>1) & 0x3;
          if (byte & 0x1)
          {
            operation_str = "NOT SUPPORTED: Read from 10 bit address ";
            operation_str_short = "! 10R ";
            ScanaStudio.dec_item_emphasize_warning();
          }
          else
          {
            operation_str = "NOT SUPPORTED: Write to 10 bit address ";
            operation_str_short = "! 10W ";
            ScanaStudio.dec_item_emphasize_warning();
          }
        }
        else if (((byte>>1) == 2) || ((byte>>1) == 3) || ((byte>>3) == 0x1F)) //Reserved
        {
          operation_str = "Reserved address ";
          operation_str_short = "RES ";
          ScanaStudio.dec_item_emphasize_warning();
        }
        else if (byte & 0x1)
        {
          operation_str = "Read from address ";
          operation_str_short = "RD ";
        }
        else
        {
          operation_str = "Write to address ";
          operation_str_short = "WR ";
        }

        if (address_opt == 0) //7 bit standard address convention
        {
          add_len = 7
          add_shift = 1;
        }
        else
        {
          add_len = 8;
          add_shift = 0;
        }

        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len) + " - R/W = " + (byte & 0x1).toString());
        ScanaStudio.dec_item_add_content(operation_str + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(operation_str_short + format_content(byte >> add_shift,address_format,add_len));
        ScanaStudio.dec_item_add_content(format_content(byte >> add_shift,address_format,add_len));

		var packet_str = operation_str + format_content(byte >> add_shift,address_format,add_len);
		if (packet_str.length > ScanaStudio.PacketMaxWidth.Content)
		{
			ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
											   operation_str, ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
			ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
											   format_content(byte >> add_shift,address_format,add_len),
											   ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
		}
		else
		{
			ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Address",
											   packet_str, ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
		}

        frame_state = SMB.CMD;
        crc8_calc(byte);
        break;

      case SMB.CMD:
        if (!isNaN(byte))
        {
          ScanaStudio.dec_item_add_content("Smart Battery System command: " + sbs_cmd[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content("SBS command: " + sbs_cmd[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content("SBS: " + sbs_cmd[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content(sbs_cmd[byte] + " (" + format_content(byte,data_format,8) + ")");
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
		  ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Command",
		                                     sbs_cmd[byte] + " (" + format_content(byte,data_format,8) + ")",
											 ScanaStudio.PacketColors.Preamble.Title, ScanaStudio.PacketColors.Preamble.Content);
        }
        frame_state = SMB.DATA;
      case SMB.DATA:
        var title = "DATA = ";
        if (item.pec == true)
        {
          title = "PEC = ";
          if (byte == crc8_get())
          {
            ScanaStudio.dec_item_add_content("PEC = " + format_content(byte,data_format,8) + " OK!");
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
            ScanaStudio.dec_item_emphasize_success();
			ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "PEC",
			                                   format_content(byte,data_format,8) + " OK",
											   ScanaStudio.PacketColors.Check.Title, ScanaStudio.PacketColors.Check.Content);
          }
          else
          {
            ScanaStudio.dec_item_add_content("Wrong PEC = " + format_content(byte,data_format,8) + " Should be = " + format_content(crc8_get(),data_format,8));
            ScanaStudio.dec_item_add_content("Wrong PEC = " + format_content(byte,data_format,8) + " / " + format_content(crc8_get(),data_format,8));
            ScanaStudio.dec_item_add_content("Err !" + format_content(byte,data_format,8));
            ScanaStudio.dec_item_add_content("!" + format_content(byte,data_format,8));
            ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
            ScanaStudio.dec_item_emphasize_error();
			ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "PEC",
			                                   format_content(byte,data_format,8) + " WRONG",
											   ScanaStudio.PacketColors.Error.Title, ScanaStudio.PacketColors.Error.Content);
          }
        }
        else
        {
          crc8_calc(byte);
          ScanaStudio.dec_item_add_content("Data = " + format_content(byte,data_format,8));
          ScanaStudio.dec_item_add_content(format_content(byte,data_format,8));
		  ScanaStudio.packet_view_add_packet(false, item.channel_index, item.start_sample_index, item.end_sample_index, "Data",
											 format_content(byte,data_format,8), ScanaStudio.PacketColors.Data.Title, ScanaStudio.PacketColors.Data.Content);
		  ScanaStudio.hex_view_add_byte(item.channel_index, item.start_sample_index, item.end_sample_index, byte);
        }
        frame_state = SMB.DATA;
      default:
    }
  }

  ScanaStudio.dec_item_end();
}


//Function called to generate demo siganls (when no physical device is attached)
function on_build_demo_signals()
{

  //Use the function below to get the number of samples to be built
  var samples_to_build = ScanaStudio.builder_get_maximum_samples_count();
  i2c_builder = ScanaStudio.load_builder_object("i2c.js");
  ch_sda = ScanaStudio.gui_get_value("ch_sda");
  ch_scl = ScanaStudio.gui_get_value("ch_scl");
  pec_enable = ScanaStudio.gui_get_value("pec_enable");
  smb_f = ScanaStudio.builder_get_sample_rate()/100;
  var silence_period = (samples_to_build / (125));
  if (smb_f < 1) smb_f = 1;
  if (smb_f > 100e3) smb_f = 100e3;
  i2c_builder.config(ch_scl,ch_sda,smb_f);

  while (ScanaStudio.builder_get_samples_acc(ch_scl) < samples_to_build)
  {
    i2c_builder.put_silence(silence_period);
    i2c_builder.put_start();
    crc8_reset();
    var random_size = Math.floor(Math.random()*10) + 1;
    var w;
    for (w = 0; w < random_size; w++)
    {
      random_data = Math.round(Math.random()*256);
      if (w == random_size-1)
      {
        if (pec_enable && (w > 0))
        {
          random_data = crc8_get();
        }
        ack = 1;
      }
      else
      {
        crc8_calc(random_data);
        ack = 0;
      }
      i2c_builder.put_byte(random_data,ack);
    }
    i2c_builder.put_stop();
  }
}

var sbs_cmd = [];
function build_sbs_cmds()
{
  var i;
  sbs_cmd = [];
  for (i = 0; i < 256; i++)
  {
    sbs_cmd.push("Reserved"); //Unknown or invalid SBS command
  }
  sbs_cmd[0x00] = "SBS ManufacturerAccess";
  sbs_cmd[0x01] = "SBS RemainingCapacityAlarm";
  sbs_cmd[0x02] = "SBS RemainingTimeAlarm";
  sbs_cmd[0x03] = "SBS BatteryMode		";
  sbs_cmd[0x04] = "SBS AtRate			";
  sbs_cmd[0x05] = "SBS AtRateTimeToFull";
  sbs_cmd[0x06] = "SBS AtRateTimeToEmpty";
  sbs_cmd[0x07] = "SBS AtRateOK		";
  sbs_cmd[0x08] = "SBS Temperature		";
  sbs_cmd[0x09] = "SBS Voltage			";
  sbs_cmd[0x0a] = "SBS Current			";
  sbs_cmd[0x0b] = "SBS AverageCurrent	";
  sbs_cmd[0x0c] = "SBS MaxError		";
  sbs_cmd[0x0d] = "SBS RelativeStateOfCharge";
  sbs_cmd[0x0e] = "SBS AbsoluteStateOfCharge";
  sbs_cmd[0x0f] = "SBS RemainingCapacity";
  sbs_cmd[0x10] = "SBS FullChargeCapacity";
  sbs_cmd[0x11] = "SBS RunTimeToEmpty	";
  sbs_cmd[0x12] = "SBS AverageTimeToEmpty";
  sbs_cmd[0x13] = "SBS AverageTimeToFull";
  sbs_cmd[0x14] = "SBS ChargingCurrent	";
  sbs_cmd[0x15] = "SBS ChargingVoltage	";
  sbs_cmd[0x16] = "SBS BatteryStatus	";
  sbs_cmd[0x17] = "SBS CycleCount		";
  sbs_cmd[0x18] = "SBS DesignCapacity	";
  sbs_cmd[0x19] = "SBS DesignVoltage	";
  sbs_cmd[0x1a] = "SBS SpecificationInfo";
  sbs_cmd[0x1b] = "SBS ManufactureDate	";
  sbs_cmd[0x1c] = "SBS SerialNumber	";
  sbs_cmd[0x20] = "SBS ManufacturerName";
  sbs_cmd[0x21] = "SBS DeviceName		";
  sbs_cmd[0x22] = "SBS DeviceChemistry	";
  sbs_cmd[0x23] = "SBS ManufacturerData";
  sbs_cmd[0x2f] = "SBS OptionalMfgFunction";
  sbs_cmd[0x3c] = "SBS OptionalMfgFunction";
  sbs_cmd[0x3d] = "SBS OptionalMfgFunction";
  sbs_cmd[0x3e] = "SBS OptionalMfgFunction";
  sbs_cmd[0x3f] = "SBS OptionalMfgFunction";
};


/*
  Helper function to convert data to formated text
  according to formating options set by the user
*/
function format_content(data,data_format,size_bits)
{
  switch (data_format) {
    case 0: //HEX
      return "0x" + pad(data.toString(16),Math.ceil(size_bits/4));
      break;
    case 1: //Binary
      return to_binary_str(data,size_bits);
      break;
    case 2: // Dec
      return data.toString(10);
      break;
    case 3: //ASCII
      return " '" + String.fromCharCode(data) + "'"
      break;
    default:
  }
}

/* Helper fonction to convert value to binary, including 0-padding
  and groupping by 4-bits packets
*/
function to_binary_str(value, size)
{
  var i;
  var str = pad(value.toString(2),size);
  var ret = "";
  for (i = 0; i < str.length; i+= 4)
  {
    ret += str.slice(i,(i+4)) + " ";
  }
  ret = "0b" + ret + str.slice(i);
  return ret;
}

/*  A helper function add leading "0"s to numbers
      Parameters
        * num_str: A string of the number to be be 0-padded
        * size: The total wanted size of the output string
*/
function pad(num_str, size) {
    while (num_str.length < size) num_str = "0" + num_str;
    return num_str;
}


/*
 SMBus CRC calculation functions
*/
var crc;
var POLYNOMIAL = (0x1070 << 3);
function crc8_reset()
{
  crc = 0;
}

function crc8_get()
{
  return (crc);
}

function crc8_calc(inData )
{
	var i;
  var data;
  data = crc ^ inData;
  data <<= 8;

	for (i = 0; i < 8; i++)
  {
		if (( data & 0x8000 ) != 0 )
    {
        data = data ^ POLYNOMIAL;
    }
		data = data << 1;
	}

	crc = ( data >> 8 ) & 0xFF;
}
